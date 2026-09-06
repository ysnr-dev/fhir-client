import { makeFieldUpdater } from "../lib/form";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { TreatmentItem } from "../api/masterClient";
import {
  useTreatmentItemLayout,
  useTreatmentItemLayouts,
  useTreatmentItemSearch,
  useTreatmentItemsByCodes,
  useTreatmentSetMembers,
} from "../api/masterQueries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  emptyTreatmentOrderForm,
  orderEntries,
  splitTreatmentOrderValues,
  topLevelItems,
  type TreatmentOrderEntry,
  type TreatmentOrderFormValues,
  type TreatmentOrderItemLine,
  type TreatmentOrderSplit,
} from "../fhir/treatmentOrderHelpers";
import {
  treatmentPerformSummary,
  type TreatmentImmediatePerforms,
  type TreatmentPerformFormValues,
} from "../fhir/treatmentResultHelpers";
import { scheduleSummary, slotDate, slotTime, today } from "../fhir/scheduleHelpers";
import type { SlotSelection } from "../fhir/appointmentHelpers";
import { AppointmentSlotPicker } from "./AppointmentSlotPicker";
import { Modal } from "./Modal";
import { useBulkStartDate } from "../hooks/useBulkStartDate";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";
import { TreatmentPerformInputModal } from "./TreatmentPerformModal";

// 処置オーダーの入力フォーム。処置伝票(処置オーダーレイアウト)のタブと
// 個別検索から項目を選び、選んだ内容を GP ごとに確認してから登録する。
//
// 1 GP = 単独で選んだ処置項目 1 つ、またはセット 1 つ。セットは親を GP とし、
// 構成する処置は GP の中身として並べる。FHIR には検体検査のパネルと同じく
// セット親と構成項目を親子の ServiceRequest で保存する。
//
// 生理検査と違い、GP 単位の依頼病名・検査目的・特別指示と、オーダー枠ごとの
// 至急区分は持たない(処置ではこれらを入力しない)。GP の枠に並ぶのは項目そのものだけで、
// オーダー枠には実施日時(または予約)と即実施だけが載る。
//
// 選んだ項目は、オーダー時点のマスタの内容(名称・略称)を写して持つ。
// マスタを直しても過去のオーダーの中身が変わらないようにするため。
//
// 「即実施」を選ぶと、診察室でその場で処置する運用のために、登録と同時に実施記録を作って
// Task を実施済にする。実施入力は処置一覧と同じモーダルで、登録されるオーダー
// 単位に入れる(単独オーダーの項目を混ぜて選ぶとオーダーが分かれるため)。

interface TreatmentOrderFormProps {
  patientId: string;
  initialValues?: TreatmentOrderFormValues;
  /**
   * performs は即実施の実施入力(オーダーごと)。即実施でない場合は null。
   * 編集では即実施を出さないので常に null。
   */
  onSubmit: (
    values: TreatmentOrderFormValues,
    performs: TreatmentImmediatePerforms | null,
    /**
     * 予約必須オーダーの予約(キーは処置項目コード)。
     * 編集では、予約日時を選び直したときだけ付け替え先の枠が入る。
     */
    bookings: Record<string, SlotSelection> | null,
  ) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /**
   * 保存済みオーダーの編集。更新は 1 つのヘッダへの書き戻しなのでオーダーを
   * 分けられず、単独の項目を他の項目と同居させられない(新規登録は分けられる)。
   */
  editing?: boolean;
  /**
   * 編集で、このオーダーに紐づく処置予約が見つかっているか。予約があるときだけ
   * 日時の変更を出す(付け替える先の予約が無ければ変えようがない)。
   */
  hasBooking?: boolean;
  /**
   * オーダーセットの適用日。外から開始日をまとめて入れるときに渡す(値が変わった
   * ときだけ反映し、他の入力は保つ)。
   */
  bulkStartDate?: string;
  /**
   * オーダーセットの内容として入力する(既定は患者に出すオーダー)。患者と日付に
   * 依存する入力を出さず、その検証も外す。値そのものは既定値のまま残り、保存時に
   * サニタイザが落とす(fhir/orderSetHelpers.ts)。
   */
  setMode?: boolean;
  /** 送信ボタンを出さない(積んだフォームを外から一括 submit する画面で使う)。 */
  hideSubmit?: boolean;
}

type ActiveTab = { kind: "layout"; id: number } | { kind: "search" };

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TreatmentOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  editing = false,
  hasBooking = false,
  bulkStartDate,
  setMode = false,
  hideSubmit = false,
}: TreatmentOrderFormProps) {
  const [values, setValues] = useState<TreatmentOrderFormValues>(initialValues ?? emptyTreatmentOrderForm);
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [active, setActive] = useState<ActiveTab | null>(null);
  const [searchCodes, setSearchCodes] = useState<string[]>([]);
  // 即実施。オーダー単位に選べる(添字はどちらも splitTreatmentOrderValues のキー)。
  const [performNow, setPerformNow] = useState<Record<string, boolean>>({});
  const [performs, setPerforms] = useState<Record<string, TreatmentPerformFormValues>>({});
  // 実施入力を開いているオーダー。まとめオーダーのキーは空文字なので null と区別する。
  const [performTarget, setPerformTarget] = useState<string | null>(null);
  // 予約必須項目の予約(処置項目コード → 選んだ枠)。モーダルで選ぶだけで、
  // サーバーに書かれるのはオーダー登録の transaction のとき。
  const [bookings, setBookings] = useState<Record<string, SlotSelection>>({});
  // 予約モーダルを開いている処置項目と、モーダル内で選択中の枠(確定前)。
  const [bookingTarget, setBookingTarget] = useState<string | null>(null);
  const [pendingBooking, setPendingBooking] = useState<SlotSelection | null>(null);
  // 構成項目を入れ終えたセット。保存済みオーダーを開いたときは、登録時に外した
  // 構成項目が復活しないよう、最初から入っているセットを入れ終わり扱いにする。
  const expandedSets = useRef<Set<string>>(
    new Set(topLevelItems(initialValues?.items ?? []).map((item) => item.code)),
  );

  const problemOptions = useProblemOptions(patientId);
  const layouts = useTreatmentItemLayouts();

  const layoutTabs = useMemo(
    () => (layouts.data?.items ?? []).filter((layout) => layout.active),
    [layouts.data],
  );

  // 初期表示は先頭のレイアウト。レイアウトが 1 つも無ければ検索タブ。
  useEffect(() => {
    if (active === null && layouts.data) {
      setActive(
        layoutTabs.length > 0 ? { kind: "layout", id: layoutTabs[0].id } : { kind: "search" },
      );
    }
  }, [active, layouts.data, layoutTabs]);

  // 選べる項目のマスタを先に揃えておく。選んだ瞬間にオーダーへ写す値
  // (名称・略称・セットの構成)が要るため、伝票・検索結果・選択済みをまとめて引く。
  const layout = useTreatmentItemLayout(active?.kind === "layout" ? active.id : undefined);
  const layoutCodes = useMemo(
    () =>
      (layout.data?.cells ?? [])
        .filter((cell) => cell.cell_type === "item" && cell.item_code)
        .map((cell) => cell.item_code as string),
    [layout.data],
  );
  const catalogCodes = useMemo(
    () => [...layoutCodes, ...searchCodes, ...values.items.map((item) => item.code)],
    [layoutCodes, searchCodes, values.items],
  );

  const setMembers = useTreatmentSetMembers(catalogCodes);
  // 構成項目もオーダーに写すので、マスタ行は構成項目のぶんまで引く。
  const memberCodes = useMemo(
    () => Array.from(setMembers.data?.values() ?? []).flat(),
    [setMembers.data],
  );
  const catalog = useTreatmentItemsByCodes([...catalogCodes, ...memberCodes]);
  const catalogByCode = useMemo(() => {
    const map = new Map<string, TreatmentItem>();
    for (const item of catalog.data?.items ?? []) map.set(item.item_code, item);
    return map;
  }, [catalog.data]);

  // マスタの処置オーダー項目を、オーダーに写す 1 行に変換する。
  const buildLine = useCallback(
    (item: TreatmentItem, parentCode: string): TreatmentOrderItemLine => ({
      // 画面で足した項目は登録時に採番されるので、この時点では id を持たない。
      id: "",
      code: item.item_code,
      name: item.name,
      shortName: item.short_name ?? "",
      parentCode,
      groupable: item.groupable,
      // オーダー枠ごとの実施日時(単独枠用)。まとめ枠は values 側。
      date: today(),
      time: "",
    }),
    [],
  );

  const selectedCodes = useMemo(
    () => new Set(values.items.map((item) => item.code)),
    [values.items],
  );

  // セットを選んだら構成項目も入れる。マスタ行が届くのを待つので効果で処理する。
  // 一度入れたセットは二度と自動で足さない(外した構成項目が復活しないように)。
  //
  // 組み立ては setValues の外で行う。更新関数の中で expandedSets を書き換えると、
  // StrictMode が更新関数を 2 回呼ぶときに 2 回目が「追加済み」と判断してしまう。
  useEffect(() => {
    const members = setMembers.data;
    if (!members) return;

    const pending = topLevelItems(values.items).filter(
      (item) => !expandedSets.current.has(item.code) && (members.get(item.code)?.length ?? 0) > 0,
    );
    if (pending.length === 0) return;

    const items = [...values.items];
    const expanded: string[] = [];
    let changed = false;

    for (const set of pending) {
      const memberCodesOfSet = members.get(set.code) ?? [];
      const memberRows = memberCodesOfSet
        .map((code) => catalogByCode.get(code))
        .filter((row): row is TreatmentItem => Boolean(row));
      // マスタ行がまだ揃っていないセットは次の描画に回す。
      if (memberRows.length !== memberCodesOfSet.length) continue;

      expanded.push(set.code);
      for (const row of memberRows) {
        const index = items.findIndex((item) => item.code === row.item_code);
        if (index < 0) {
          items.push(buildLine(row, set.code));
          changed = true;
        } else if (!items[index].parentCode) {
          // 単独で選んでいた項目は、二重に入らないようセットの構成項目に寄せる。
          items[index] = { ...items[index], parentCode: set.code };
          changed = true;
        }
      }
    }

    if (expanded.length === 0) return;
    for (const code of expanded) expandedSets.current.add(code);
    if (changed) setValues((current) => ({ ...current, items }));
  }, [buildLine, catalogByCode, setMembers.data, values.items]);

  const update = makeFieldUpdater(setValues);

  function updateItem(code: string, patch: Partial<TreatmentOrderItemLine>) {
    setValues((current) => ({
      ...current,
      items: current.items.map((line) => (line.code === code ? { ...line, ...patch } : line)),
    }));
  }

  // 処置項目の選択・解除。セットを外すと構成項目も一緒に外れ、構成項目だけを外すと
  // そのセットからその処置を除いたオーダーになる。
  function toggle(item: TreatmentItem) {
    const code = item.item_code;
    // 解除なら予約(未登録の選択)も捨てる。選択かどうかは setValues の外で判定すると
    // StrictMode の二重呼び出しで狂うので、素朴に「あれば消す」だけにする。
    if (values.items.some((line) => line.code === code)) {
      setBookings((current) => {
        if (!current[code]) return current;
        const next = { ...current };
        delete next[code];
        return next;
      });
    }
    setValues((current) => {
      const selected = current.items.find((line) => line.code === code);
      if (selected) {
        expandedSets.current.delete(code);
        return {
          ...current,
          items: current.items.filter((line) => line.code !== code && line.parentCode !== code),
        };
      }
      // 選択済みのセットの構成項目なら、単独ではなくそのセットにぶら下げて戻す。
      const parent = topLevelItems(current.items).find((line) =>
        (setMembers.data?.get(line.code) ?? []).includes(code),
      );
      return { ...current, items: [...current.items, buildLine(item, parent?.code ?? "")] };
    });
  }

  // 処置項目を外す。セットを外すと構成項目も一緒に外れる。
  // オーダー枠ごと外すときは、その枠の GP をまとめて渡す。
  function removeCodes(codes: string[]) {
    const targets = new Set(codes);
    setValues((current) => {
      for (const code of codes) expandedSets.current.delete(code);
      return {
        ...current,
        items: current.items.filter(
          (line) => !targets.has(line.code) && !targets.has(line.parentCode),
        ),
      };
    });
    // 外した項目の予約(未登録の選択)も一緒に捨てる。
    setBookings((current) => {
      if (!codes.some((code) => current[code])) return current;
      const next = { ...current };
      for (const code of codes) delete next[code];
      return next;
    });
  }

  function remove(code: string) {
    removeCodes([code]);
  }

  // 単独オーダーかどうかは登録時点のマスタで決める(保存済みのオーダーを開いた
  // ときは明細から復元できないため)。マスタから消えた項目は今の値のままにする。
  const refreshedItems = useMemo(
    () =>
      values.items.map((line) =>
        line.parentCode
          ? line
          : { ...line, groupable: catalogByCode.get(line.code)?.groupable ?? line.groupable },
      ),
    [values.items, catalogByCode],
  );
  // 登録すると分かれるオーダーの単位。即実施の実施入力もこの単位で入れる。
  const splits = useMemo(
    () => splitTreatmentOrderValues({ ...values, items: refreshedItems }),
    [values, refreshedItems],
  );

  // 予約必須かどうか・所要時間はマスタの今の値で見る(groupable と同じ扱い)。
  const requiresBooking = useCallback(
    (code: string) => catalogByCode.get(code)?.requires_appointment ?? false,
    [catalogByCode],
  );

  // セット適用で実施日をまとめて入れる。まとめ枠と単独枠の両方に入れるが、予約する項目は
  // 予約した枠の日時が正なので動かさない。
  useBulkStartDate(bulkStartDate, (date) =>
    setValues((v) => ({
      ...v,
      startDate: date,
      items: v.items.map((line) =>
        line.parentCode || line.groupable || requiresBooking(line.code)
          ? line
          : { ...line, date },
      ),
    })),
  );

  // 予約必須の処置は予約した日時に行うものなので、登録と同時に実施済にはできない。
  // 判定はオーダー単位。
  const canPerformNow = useCallback(
    (split: TreatmentOrderSplit) =>
      !topLevelItems(split.values.items).some((line) => requiresBooking(line.code)),
    [requiresBooking],
  );

  // 実施入力を開く項目が 1 つでもあるか(処置一覧の「実施」と同じ判定)。
  // セットは処置そのものではなく依頼の束ね方なので、構成項目だけで判定する。
  const needsPerformInput = useCallback(
    (items: TreatmentOrderItemLine[]): boolean => {
      const codes = items
        .map((item) => item.code)
        .filter((code) => catalogByCode.get(code)?.kind !== "set");
      if (codes.length === 0) return true;

      return codes.some((code) => catalogByCode.get(code)?.requires_perform_input ?? true);
    },
    [catalogByCode],
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (values.items.length === 0) {
      setValidationError("処置項目を 1 つ以上選択してください。");
      return;
    }

    let items = refreshedItems;
    const groups = topLevelItems(items);
    const solo = groups.find((line) => !line.groupable);
    if (editing && solo && groups.length > 1) {
      setValidationError(
        `単独オーダーの項目「${solo.name}」は他の処置項目と同じオーダーにできません。`,
      );
      return;
    }

    const startDate = values.startDate;

    // セットの内容としての入力では日付・予約を持たない(適用時に入れる)。
    if (!setMode && groups.some((line) => line.groupable) && !startDate) {
      setValidationError("実施日を入力してください。");
      return;
    }
    if (!editing && !setMode) {
      const soloGroups = groups.filter((line) => !line.groupable);
      const withoutDate = soloGroups.find((line) => !requiresBooking(line.code) && !line.date);
      if (withoutDate) {
        setValidationError(`「${withoutDate.name}」の実施日を入力してください。`);
        return;
      }
      // 予約必須の枠は予約が実施日時そのもの。選ばずには登録させない。
      const unbooked = soloGroups.find(
        (line) => requiresBooking(line.code) && !bookings[line.code],
      );
      if (unbooked) {
        setValidationError(`「${unbooked.name}」の予約を取得してください。`);
        return;
      }
    }

    // 即実施にするオーダー。予約必須のオーダーはチェックボックス自体を
    // 無効化しているが、状態に残った値で実施記録を作らないよう判定にも噛ませる。
    const performingSplits = splits.filter(
      (split) => performNow[split.key] && canPerformNow(split),
    );

    // 即実施は実施記録まで作る操作なので、入れずに登録できてしまわないようにする
    // (実施入力をしない項目だけのオーダーは、実施記録を作らないので対象外)。
    if (
      performingSplits.some(
        (split) => needsPerformInput(split.values.items) && !performs[split.key],
      )
    ) {
      setValidationError("即実施にする処置の実施入力を行ってください。");
      return;
    }

    // 編集では、枠を選び直したぶんだけが入る(選ばなければ空なので、予約は今のまま)。
    const selected = Object.fromEntries(
      Object.entries(bookings).filter(([code]) => groups.some((line) => line.code === code)),
    );
    const activeBookings = Object.keys(selected).length > 0 ? selected : null;

    setValidationError(null);
    onSubmit(
      {
        ...values,
        startDate,
        items,
        problem: refreshProblemDisplay(values.problem, problemOptions),
      },
      performingSplits.length > 0
        ? new Map(
            performingSplits.map((split) => [
              split.key,
              needsPerformInput(split.values.items) ? (performs[split.key] ?? null) : null,
            ]),
          )
        : null,
      activeBookings,
    );
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する(処方・注射と同じ)。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  const entries = orderEntries(values.items);
  // 単独オーダーの印はマスタが持つ。保存済みのオーダーを開いた場合は明細から
  // 復元できないので、選択中の一覧も登録時と同じくマスタの今の値で見せる。
  const isSolo = (entry: TreatmentOrderEntry) =>
    !(catalogByCode.get(entry.item.code)?.groupable ?? entry.item.groupable);
  // オーダー枠。まとめられる GP は 1 枠、単独の項目は項目ごとに 1 枠。
  const groupedEntries = entries.filter((entry) => !isSolo(entry));
  const soloEntries = entries.filter(isSolo);

  function openBooking(code: string) {
    setPendingBooking(bookings[code] ?? null);
    setBookingTarget(code);
  }

  function clearBooking(code: string) {
    setBookings((current) => {
      const next = { ...current };
      delete next[code];
      return next;
    });
  }

  function commitBooking() {
    if (!bookingTarget || !pendingBooking) return;
    setBookings((current) => ({ ...current, [bookingTarget]: pendingBooking }));
    // 編集は 1 オーダーへの書き戻しで、ヘッダの実施日時が予約の枠と同期している値。
    // 選び直した枠に合わせてここで書き換える(新規登録では登録時に枠から写す)。
    if (editing) {
      const slot = pendingBooking.slots[0];
      setValues((current) => ({
        ...current,
        startDate: slotDate(slot),
        startTime: slotTime(slot),
      }));
    }
    setBookingTarget(null);
    setPendingBooking(null);
  }

  // 予約モーダルを開いている項目の所要時間。未設定は 1 枠ぶん(picker の既定)。
  const bookingDuration = bookingTarget
    ? (catalogByCode.get(bookingTarget)?.duration_minutes ?? undefined)
    : undefined;
  // 実施入力を開いているオーダー。
  const performSplit =
    performTarget === null ? undefined : splits.find((split) => split.key === performTarget);

  return (
    <>
      <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
        {validationError && (
          <div className="error-banner" role="alert" ref={validationErrorRef}>
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={submitError} />
        <ErrorBanner error={layouts.error ?? setMembers.error ?? catalog.error} />

        <fieldset>
          <legend>処置共通</legend>
          {!setMode && (
            <label>
              対象プロブレム
              <ProblemSelect
                value={values.problem}
                options={problemOptions}
                onChange={(problem) => update("problem", problem)}
              />
            </label>
          )}
          <label>
            入外区分
            <select
              value={values.setting}
              onChange={(e) => update("setting", e.target.value as PrescriptionSetting)}
            >
              <option value="">選択してください</option>
              {SETTING_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          {/* 実施日・実施時刻は伝票共通ではなく「選択中」のオーダー枠ごとに
              入力する(オーダー単位で扱いが変わり、予約必須の項目は予約から日時が
              入るため)。 */}
        </fieldset>

        {/* 処置伝票(レイアウト)と処置項目検索の切替。伝票が複数あればその数だけタブが並ぶ。 */}
        <div className="order-select__tabs" role="tablist">
          {layoutTabs.map((tab) => {
            const selected = active?.kind === "layout" && active.id === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={selected ? "order-select__tab is-active" : "order-select__tab"}
                onClick={() => setActive({ kind: "layout", id: tab.id })}
              >
                {tab.name}
              </button>
            );
          })}
          <button
            type="button"
            role="tab"
            aria-selected={active?.kind === "search"}
            className={
              active?.kind === "search" ? "order-select__tab is-active" : "order-select__tab"
            }
            onClick={() => setActive({ kind: "search" })}
          >
            処置項目検索
          </button>
        </div>

        {active?.kind === "layout" && (
          <LayoutSelectGrid
            layout={layout.data}
            error={layout.error}
            catalogByCode={catalogByCode}
            selectedCodes={selectedCodes}
            onToggle={toggle}
          />
        )}
        {active?.kind === "search" && (
          <ItemSearchTab
            selectedCodes={selectedCodes}
            onToggle={toggle}
            onResults={setSearchCodes}
          />
        )}

        <section className="order-select__preview">
          <h3>選択中({entries.length})</h3>
          {entries.length === 0 && (
            <p className="order-select__muted">処置項目を選択してください</p>
          )}

          {/* 1 枠 = 登録される 1 オーダー。まとめられる GP は 1 つの枠に集め、
              単独の項目は項目ごとに枠が分かれる。実施日時・即実施は
              オーダー単位の設定なので枠の中に置く。 */}
          {groupedEntries.length > 0 && (
            <OrderFrame
              setMode={setMode}
              number={groupedEntries.length > 0 && soloEntries.length > 0 ? 1 : undefined}
              onRemove={() => removeCodes(groupedEntries.map((entry) => entry.item.code))}
              perform={
                editing || setMode
                  ? null
                  : {
                      split: splits.find((split) => split.key === "") ?? null,
                      checked: Boolean(performNow[""]),
                      onToggle: (checked) =>
                        setPerformNow((current) => ({ ...current, "": checked })),
                      onOpen: () => setPerformTarget(""),
                      needsInput: (split) => needsPerformInput(split.values.items),
                      canPerform: canPerformNow,
                      summary: performs[""] ? treatmentPerformSummary(performs[""]) : null,
                    }
              }
              schedule={
                <FrameDateTime
                  date={values.startDate}
                  time={values.startTime}
                  onChangeDate={(date) => update("startDate", date)}
                  onChangeTime={(time) => update("startTime", time)}
                />
              }
            >
              {groupedEntries.map((entry, index) => (
                <GroupEditor
                  key={entry.item.code}
                  entry={entry}
                  number={index + 1}
                  solo={false}
                  onRemove={remove}
                />
              ))}
            </OrderFrame>
          )}

          {soloEntries.map((entry, index) => {
            const code = entry.item.code;
            const reserved = requiresBooking(code);
            const booking = bookings[code];

            return (
              <OrderFrame
                key={code}
                setMode={setMode}
                number={
                  entries.length > 1
                    ? (groupedEntries.length > 0 ? 1 : 0) + index + 1
                    : undefined
                }
                onRemove={() => remove(code)}
                perform={
                  editing || setMode
                    ? null
                    : {
                        split: splits.find((split) => split.key === code) ?? null,
                        checked: Boolean(performNow[code]),
                        onToggle: (checked) =>
                          setPerformNow((current) => ({ ...current, [code]: checked })),
                        onOpen: () => setPerformTarget(code),
                        needsInput: (split) => needsPerformInput(split.values.items),
                        canPerform: canPerformNow,
                        summary: performs[code] ? treatmentPerformSummary(performs[code]) : null,
                      }
                }
                schedule={
                  reserved ? (
                    editing ? (
                      // 編集では、予約日時もここから変える(予約タブからは変えない。
                      // オーダーの実施日時と予約を必ず一緒に動かすため)。日時は予約と
                      // 同期しているヘッダの値で、枠を選び直すとその枠の日時になる。
                      <span className="rad-order-frame__booking">
                        <span className="rad-order-frame__booked">
                          実施日時 {values.startDate} {values.startTime}
                        </span>
                        {hasBooking ? (
                          <button type="button" onClick={() => openBooking(code)}>
                            予約日時を変更
                          </button>
                        ) : (
                          <span className="rad-order-frame__note">(予約が見つかりません)</span>
                        )}
                      </span>
                    ) : booking ? (
                      <span className="rad-order-frame__booking">
                        <span className="rad-order-frame__booked">{bookingLabel(booking)}</span>
                        <button type="button" onClick={() => openBooking(code)}>
                          変更
                        </button>
                        <button type="button" onClick={() => clearBooking(code)}>
                          解除
                        </button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => openBooking(code)}>
                        予約
                      </button>
                    )
                  ) : (
                    <FrameDateTime
                      date={editing ? values.startDate : entry.item.date}
                      time={editing ? values.startTime : entry.item.time}
                      onChangeDate={(date) =>
                        editing ? update("startDate", date) : updateItem(code, { date })
                      }
                      onChangeTime={(time) =>
                        editing ? update("startTime", time) : updateItem(code, { time })
                      }
                    />
                  )
                }
              >
                <GroupEditor entry={entry} number={1} solo onRemove={remove} />
              </OrderFrame>
            );
          })}
        </section>

        {!hideSubmit && (
          <div className="prescription-form__submit">
            <button type="submit" disabled={submitting}>
              {submitting ? "送信中..." : submitLabel}
            </button>
          </div>
        )}
      </form>

      {/* 実施入力は独自の <form> を持つため、外側フォームの子孫に置かない
          (form の入れ子は不正で、送信が外へ漏れる)。 */}
      {performSplit && (
        <TreatmentPerformInputModal
          items={performSplit.values.items}
          initialValues={performs[performSplit.key] ?? null}
          submitLabel="実施内容を確定"
          onSubmit={(performValues) => {
            setPerforms((current) => ({ ...current, [performSplit.key]: performValues }));
            setPerformTarget(null);
          }}
          onClose={() => setPerformTarget(null)}
        />
      )}

      {/* 処置予約。ここでは枠を選ぶだけで、予約が書かれるのはオーダー登録のとき
          (同じ transaction に同梱)。登録をやめれば予約も残らない。 */}
      {bookingTarget && (
        <Modal
          title={`処置予約: ${catalogByCode.get(bookingTarget)?.name ?? bookingTarget}`}
          onClose={() => setBookingTarget(null)}
          className="rad-booking-modal"
        >
          <div className="rad-booking">
            {bookingDuration && (
              <p className="order-select__muted">
                所要時間 {bookingDuration} 分。覆うだけの連続した空き枠を押さえます。
              </p>
            )}
            <AppointmentSlotPicker
              scheduleType="exam"
              requiredMinutes={bookingDuration}
              // 項目マスタに紐づけた枠表(透析なら透析室の枠、など)を最初から選んでおく。
              defaultScheduleId={
                catalogByCode.get(bookingTarget)?.appointment_schedule_id ?? undefined
              }
              selected={pendingBooking}
              onSelect={setPendingBooking}
            />
            <div className="rad-booking__actions">
              <button type="button" onClick={commitBooking} disabled={!pendingBooking}>
                この枠で予約
              </button>
              <button type="button" onClick={() => setBookingTarget(null)}>
                キャンセル
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** 予約済みの枠の表示。「2026-08-19 09:00-10:00 CT枠(...)」。 */
function bookingLabel(selection: SlotSelection): string {
  const first = selection.slots[0];
  const last = selection.slots[selection.slots.length - 1];
  return `${slotDate(first)} ${slotTime(first)}-${last.end.slice(11, 16)} ${scheduleSummary(selection.schedule)}`;
}

/** 即実施の設定(オーダー単位)。編集画面では使わないので null を渡す。 */
interface FramePerform {
  split: TreatmentOrderSplit | null;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  onOpen: () => void;
  needsInput: (split: TreatmentOrderSplit) => boolean;
  canPerform: (split: TreatmentOrderSplit) => boolean;
  summary: string | null;
}

/**
 * 登録される 1 オーダーぶんの枠。実施日時(または予約)・即実施という
 * オーダー単位の設定を上下に置き、間に GP を並べる。
 */
function OrderFrame({
  setMode = false,
  number,
  schedule,
  perform,
  onRemove,
  children,
}: {
  /** セットの内容としての入力(日時・予約・即実施は出さない)。 */
  setMode?: boolean;
  /** オーダーが複数に分かれるときだけ振る通し番号。1 件なら付けない。 */
  number?: number;
  /** 実施日時の入力、または予約の操作。 */
  schedule: ReactNode;
  perform: FramePerform | null;
  /** このオーダー(枠内の処置項目すべて)を選択から外す。 */
  onRemove: () => void;
  children: ReactNode;
}) {
  const split = perform?.split ?? null;
  // 予約必須の処置を含むオーダーは、登録と同時に実施済にできない。
  const canPerform = split ? perform?.canPerform(split) : false;

  return (
    <div className="rad-order-frame">
      <div className="rad-order-frame__head">
        {number !== undefined && <span className="rad-order-frame__number">{number}</span>}
        {!setMode && schedule}
        {/* このオーダーを丸ごと外す。GP 単位で外すときは GP の × を使う。 */}
        <button
          type="button"
          className="rp-card__icon-button rad-order-frame__remove"
          title="このオーダーを削除"
          aria-label="このオーダーを削除"
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </div>

      <div className="rad-order-frame__body">{children}</div>

      {perform && split && (
        <div className="rad-order-frame__foot">
          <label className="rad-order-frame__perform">
            <input
              type="checkbox"
              checked={perform.checked && canPerform}
              disabled={!canPerform}
              onChange={(e) => perform.onToggle(e.target.checked)}
            />
            即実施(登録と同時に実施済にする)
          </label>
          {!canPerform && (
            <span className="order-select__muted">予約する処置は即実施にできません</span>
          )}
          {perform.checked &&
            canPerform &&
            (perform.needsInput(split) ? (
              <>
                <button type="button" onClick={perform.onOpen}>
                  実施入力
                </button>
                {perform.summary ? (
                  <span className="rad-perform-now__summary">{perform.summary}</span>
                ) : (
                  <span className="order-select__muted">未入力</span>
                )}
              </>
            ) : (
              <span className="order-select__muted">
                実施入力のない処置です(実施済にします)
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

/** オーダー枠の実施日・実施時刻。時刻は部門側に任せる場合は未入力でよい任意入力。 */
function FrameDateTime({
  date,
  time,
  onChangeDate,
  onChangeTime,
}: {
  date: string;
  time: string;
  onChangeDate: (date: string) => void;
  onChangeTime: (time: string) => void;
}) {
  return (
    <span className="rad-order-frame__datetime">
      <label>
        実施日
        <input type="date" value={date} onChange={(e) => onChangeDate(e.target.value)} />
      </label>
      <label>
        実施時刻
        <input type="time" value={time} onChange={(e) => onChangeTime(e.target.value)} />
      </label>
    </span>
  );
}

// GP 1 つぶんの確認。セットなら構成する処置を並べる。処置では GP 単位の記入欄
// (依頼病名・検査目的・特別指示)を持たないので、項目そのものだけが並ぶ。
function GroupEditor({
  entry,
  number,
  solo,
  onRemove,
}: {
  entry: TreatmentOrderEntry;
  number: number;
  /** 単独オーダーの項目(登録時にこの GP だけで 1 オーダーになる)。 */
  solo: boolean;
  onRemove: (code: string) => void;
}) {
  const { item, members } = entry;

  return (
    <div className="rad-gp">
      <div className="rad-gp__head">
        <span className="rad-gp__number">GP{number}</span>
        <span className="rad-gp__name">{item.name}</span>
        {solo && <span className="dose-conversion__badge">単独</span>}
        <button
          type="button"
          className="order-select__remove"
          onClick={() => onRemove(item.code)}
          aria-label={`${item.name} を外す`}
        >
          ×
        </button>
      </div>

      {members.length > 0 && (
        <ul className="rad-gp__members">
          {members.map((member) => (
            <li key={member.code}>
              {member.name}
              <button
                type="button"
                className="order-select__remove"
                onClick={() => onRemove(member.code)}
                aria-label={`${member.name} をこのセットから外す`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface SelectProps {
  selectedCodes: ReadonlySet<string>;
  onToggle: (item: TreatmentItem) => void;
}

// 処置伝票のグリッド。マス割りはレイアウトマスタの定義そのままで、
// 処置項目のマスにチェックボックスを重ねる。
function LayoutSelectGrid({
  layout,
  error,
  catalogByCode,
  selectedCodes,
  onToggle,
}: SelectProps & {
  layout: ReturnType<typeof useTreatmentItemLayout>["data"];
  error: unknown;
  catalogByCode: Map<string, TreatmentItem>;
}) {
  if (!layout) {
    return <ErrorBanner error={error} />;
  }

  const cellsByPosition = new Map(
    layout.cells.map((cell) => [`${cell.grid_row}-${cell.grid_column}`, cell]),
  );
  const rows = Array.from({ length: layout.row_count }, (_, i) => i + 1);
  const columns = Array.from({ length: layout.column_count }, (_, i) => i + 1);

  return (
    <div className="order-select__grid-wrap">
      <ErrorBanner error={error} />
      {/* 列は幅いっぱいに均等割りするが、狭すぎるマスにならないよう最小幅は確保する。 */}
      <table className="order-select__grid" style={{ minWidth: columns.length * 104 }}>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              {columns.map((column) => {
                const cell = cellsByPosition.get(`${row}-${column}`);
                if (!cell) {
                  return <td key={column} className="order-select__cell" />;
                }
                if (cell.cell_type === "label") {
                  return (
                    <td key={column} className="order-select__cell order-select__cell--label">
                      {cell.display_name}
                    </td>
                  );
                }
                const code = cell.item_code ?? "";
                const master = catalogByCode.get(code);
                return (
                  <td key={column} className="order-select__cell">
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedCodes.has(code)}
                        // マスタ行が届く前に押されると名称が空のまま入ってしまうので、
                        // 揃うまでは押せないようにする。
                        disabled={!master}
                        onChange={() => master && onToggle(master)}
                      />
                      {cell.display_name ?? cell.item_name ?? code}
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 伝票に載っていない項目を個別に探して選ぶ。
function ItemSearchTab({
  selectedCodes,
  onToggle,
  onResults,
}: SelectProps & { onResults: (codes: string[]) => void }) {
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  // 期限切れの項目を出しても選べないだけなので、有効期間内に絞る。
  const result = useTreatmentItemSearch({ name, active: true }, page, name.trim().length > 0);

  const data = result.data;
  const hasNext = data ? page * data.per < data.total : false;

  // 検索でしか出てこない項目のセット構成もフォーム側で先に引いておく。
  useEffect(() => {
    onResults((data?.items ?? []).map((item) => item.item_code));
  }, [data, onResults]);

  return (
    <div className="order-select__search">
      <input
        type="text"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setPage(1);
        }}
        placeholder="名称・略称・カナで検索"
      />
      <ErrorBanner error={result.error} />
      {name.trim().length > 0 && (
        <>
          <ul className="order-select__search-list">
            {data?.items.map((item) => (
              <li key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedCodes.has(item.item_code)}
                    onChange={() => onToggle(item)}
                  />
                  {item.name}
                  {item.short_name && <span className="order-select__muted">{item.short_name}</span>}
                  {item.kind === "set" && <span className="dose-conversion__badge">セット</span>}
                </label>
              </li>
            ))}
            {data && data.items.length === 0 && (
              <li className="order-select__muted">該当する処置項目がありません</li>
            )}
          </ul>
          <div className="master-search__pager">
            <button
              type="button"
              onClick={() => setPage((p) => p - 1)}
              disabled={page <= 1 || result.isFetching}
            >
              前へ
            </button>
            <span>
              {page} ページ目 (全 {data?.total ?? 0} 件)
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNext || result.isFetching}
            >
              次へ
            </button>
          </div>
        </>
      )}
    </div>
  );
}
