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
import type { PhysioItem } from "../api/masterClient";
import {
  physioExamTypeName,
  usePhysioItemLayout,
  usePhysioItemLayouts,
  usePhysioItemSearch,
  usePhysioItemsByCodes,
  usePhysioSetMembers,
} from "../api/masterQueries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  questionnaireResponsePlainText,
  type TemplateBinding,
} from "../fhir/questionnaireResponseHelpers";
import {
  PRIORITY_OPTIONS,
  emptyPhysioOrderForm,
  entryExamTypeName,
  orderEntries,
  splitPhysioOrderValues,
  topLevelItems,
  type PhysioOrderEntry,
  type PhysioOrderFormValues,
  type PhysioOrderItemLine,
  type PhysioOrderPriority,
  type PhysioOrderSplit,
} from "../fhir/physioOrderHelpers";
import {
  physioPerformSummary,
  type PhysioImmediatePerforms,
  type PhysioPerformFormValues,
} from "../fhir/physioResultHelpers";
import { scheduleSummary, slotDate, slotTime, today } from "../fhir/scheduleHelpers";
import type { SlotSelection } from "../fhir/appointmentHelpers";
import { AppointmentSlotPicker } from "./AppointmentSlotPicker";
import { Modal } from "./Modal";
import { ConditionPickerModal } from "./ConditionPickerModal";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { TemplateEntryModal } from "./TemplateEntryModal";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";
import { PhysioPerformInputModal } from "./PhysioPerformModal";
import { TemplateSchemaImages } from "./SchemaImageGallery";

// 生理検査オーダーの入力フォーム。検査伝票(生理検査オーダーレイアウト)のタブと
// 個別検索から項目を選び、選んだ内容を GP ごとに確認・記入してから登録する。
//
// 1 GP = 単独で選んだ検査項目 1 つ、またはセット 1 つ。セットは親を GP とし、
// 構成する検査は GP の中身として並べる。FHIR には検体検査のパネルと同じく
// セット親と構成項目を親子の ServiceRequest で保存する。
//
// GP ごとに依頼病名・検査目的・特別指示を入力する。検査目的と特別指示は診療記録の
// SOAP と同じテンプレート(Questionnaire)から記入でき、検査項目マスタに既定の
// テンプレートが設定してあればそれを最初から選んだ状態で開く。
//
// 選んだ項目は、オーダー時点のマスタの内容(名称・略称・検査種別)を写して持つ。
// マスタを直しても過去のオーダーの中身が変わらないようにするため。
// 生理検査と違い JJ1017 コードと部位・左右は持たない(生理検査は JJ1017 に
// 収載されておらず、部位は項目名で表す)。
//
// 「即実施」を選ぶと、診察室でその場で検査する運用のために、登録と同時に実施記録を作って
// Task を実施済にする。実施入力は生理検査一覧と同じモーダルで、登録されるオーダー
// 単位に入れる(単独オーダーの項目を混ぜて選ぶとオーダーが分かれるため)。

interface PhysioOrderFormProps {
  patientId: string;
  initialValues?: PhysioOrderFormValues;
  /**
   * performs は即実施の実施入力(オーダーごと)。即実施でない場合は null。
   * 編集では即実施を出さないので常に null。
   */
  onSubmit: (
    values: PhysioOrderFormValues,
    performs: PhysioImmediatePerforms | null,
    /**
     * 予約必須オーダーの予約(キーは検査項目コード)。至急のオーダーでは取らない。
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
   * 編集で、このオーダーに紐づく検査予約が見つかっているか。予約があるときだけ
   * 日時の変更を出す(付け替える先の予約が無ければ変えようがない)。
   */
  hasBooking?: boolean;
}

type ActiveTab = { kind: "layout"; id: number } | { kind: "search" };

/** テンプレート記入モーダルの対象。どの GP のどちらの欄かを持つ。 */
type TemplateTarget = { code: string; field: "purpose" | "remarks" };

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

export function PhysioOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  editing = false,
  hasBooking = false,
}: PhysioOrderFormProps) {
  const [values, setValues] = useState<PhysioOrderFormValues>(initialValues ?? emptyPhysioOrderForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveTab | null>(null);
  const [searchCodes, setSearchCodes] = useState<string[]>([]);
  const [templateTarget, setTemplateTarget] = useState<TemplateTarget | null>(null);
  // 依頼病名の選択モーダルを開いている GP(検査項目コード)。
  const [conditionTarget, setConditionTarget] = useState<string | null>(null);
  // 即実施。オーダー単位に選べる(添字はどちらも splitPhysioOrderValues のキー)。
  const [performNow, setPerformNow] = useState<Record<string, boolean>>({});
  const [performs, setPerforms] = useState<Record<string, PhysioPerformFormValues>>({});
  // 実施入力を開いているオーダー。まとめオーダーのキーは空文字なので null と区別する。
  const [performTarget, setPerformTarget] = useState<string | null>(null);
  // 予約必須項目の予約(検査項目コード → 選んだ枠)。モーダルで選ぶだけで、
  // サーバーに書かれるのはオーダー登録の transaction のとき。
  const [bookings, setBookings] = useState<Record<string, SlotSelection>>({});
  // 予約モーダルを開いている検査項目と、モーダル内で選択中の枠(確定前)。
  const [bookingTarget, setBookingTarget] = useState<string | null>(null);
  const [pendingBooking, setPendingBooking] = useState<SlotSelection | null>(null);
  // 構成項目を入れ終えたセット。保存済みオーダーを開いたときは、登録時に外した
  // 構成項目が復活しないよう、最初から入っているセットを入れ終わり扱いにする。
  const expandedSets = useRef<Set<string>>(
    new Set(topLevelItems(initialValues?.items ?? []).map((item) => item.code)),
  );

  const problemOptions = useProblemOptions(patientId);
  const layouts = usePhysioItemLayouts();

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
  // (JJ1017 コード・種別・部位・セットの構成・既定テンプレート)が要るため、
  // 伝票・検索結果・選択済みをまとめて引く。
  const layout = usePhysioItemLayout(active?.kind === "layout" ? active.id : undefined);
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

  const setMembers = usePhysioSetMembers(catalogCodes);
  // 構成項目もオーダーに写すので、マスタ行は構成項目のぶんまで引く。
  const memberCodes = useMemo(
    () => Array.from(setMembers.data?.values() ?? []).flat(),
    [setMembers.data],
  );
  const catalog = usePhysioItemsByCodes([...catalogCodes, ...memberCodes]);
  const catalogByCode = useMemo(() => {
    const map = new Map<string, PhysioItem>();
    for (const item of catalog.data?.items ?? []) map.set(item.item_code, item);
    return map;
  }, [catalog.data]);

  // マスタの生理検査オーダー項目を、オーダーに写す 1 行に変換する。検査種別の名称は
  // 一覧APIが添えて返すもの(exam_types)を使うので、追加の取得はいらない。
  const catalogResult = catalog.data;
  const buildLine = useCallback(
    (item: PhysioItem, parentCode: string): PhysioOrderItemLine => ({
      // 画面で足した項目は登録時に採番されるので、この時点では id を持たない。
      id: "",
      code: item.item_code,
      name: item.name,
      shortName: item.short_name ?? "",
      examTypeCode: item.exam_type_code ?? "",
      examTypeName: physioExamTypeName(catalogResult, item.exam_type_code),
      reasonConditionId: "",
      reasonName: "",
      purpose: "",
      remarks: "",
      purposeTemplate: null,
      remarksTemplate: null,
      parentCode,
      groupable: item.groupable,
      // オーダー枠ごとの実施日時・至急区分(単独枠用)。まとめ枠は values 側。
      date: today(),
      time: "",
      priority: "routine",
    }),
    [catalogResult],
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
        .filter((row): row is PhysioItem => Boolean(row));
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

  function updateItem(code: string, patch: Partial<PhysioOrderItemLine>) {
    setValues((current) => ({
      ...current,
      items: current.items.map((line) => (line.code === code ? { ...line, ...patch } : line)),
    }));
  }

  // 検査項目の選択・解除。セットを外すと構成項目も一緒に外れ、構成項目だけを外すと
  // そのセットからその検査を除いたオーダーになる。
  function toggle(item: PhysioItem) {
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

  // 検査項目を外す。セットを外すと構成項目も一緒に外れる。
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
    () => splitPhysioOrderValues({ ...values, items: refreshedItems }),
    [values, refreshedItems],
  );

  // 予約必須かどうか・所要時間はマスタの今の値で見る(groupable と同じ扱い)。
  const requiresBooking = useCallback(
    (code: string) => catalogByCode.get(code)?.requires_appointment ?? false,
    [catalogByCode],
  );

  // 予約必須の検査は予約した日時に撮るものなので、登録と同時に実施済にはできない。
  // 至急(予約なしの当日実施)なら可。判定はオーダー単位。
  const canPerformNow = useCallback(
    (split: PhysioOrderSplit) =>
      split.values.priority === "urgent" ||
      !topLevelItems(split.values.items).some((line) => requiresBooking(line.code)),
    [requiresBooking],
  );

  // 実施入力を開く項目が 1 つでもあるか(生理検査一覧の「実施」と同じ判定)。
  // セットは検査そのものではなく依頼の束ね方なので、構成項目だけで判定する。
  const needsPerformInput = useCallback(
    (items: PhysioOrderItemLine[]): boolean => {
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
      setValidationError("検査項目を 1 つ以上選択してください。");
      return;
    }

    let items = refreshedItems;
    const groups = topLevelItems(items);
    const solo = groups.find((line) => !line.groupable);
    if (editing && solo && groups.length > 1) {
      setValidationError(
        `単独オーダーの項目「${solo.name}」は他の検査項目と同じオーダーにできません。`,
      );
      return;
    }

    // 至急のオーダーは当日実施に倒す(予約も取らない)。至急区分はオーダー枠ごとの
    // 入力なので、まとめ枠と単独枠をそれぞれ見る。
    const authoredDate = values.priority === "urgent" ? today() : values.authoredDate;
    items = items.map((line) =>
      !line.parentCode && !line.groupable && line.priority === "urgent"
        ? { ...line, date: today() }
        : line,
    );

    if (values.priority !== "urgent" && groups.some((line) => line.groupable) && !authoredDate) {
      setValidationError("実施日を入力してください。");
      return;
    }
    if (!editing) {
      const soloGroups = groups.filter((line) => !line.groupable);
      const withoutDate = soloGroups.find(
        (line) => line.priority !== "urgent" && !requiresBooking(line.code) && !line.date,
      );
      if (withoutDate) {
        setValidationError(`「${withoutDate.name}」の実施日を入力してください。`);
        return;
      }
      // 予約必須の枠は予約が実施日時そのもの。選ばずには登録させない(至急を除く)。
      const unbooked = soloGroups.find(
        (line) =>
          line.priority !== "urgent" && requiresBooking(line.code) && !bookings[line.code],
      );
      if (unbooked) {
        setValidationError(`「${unbooked.name}」の予約を取得してください。`);
        return;
      }
    }

    // 即実施にするオーダー。予約必須の非至急オーダーはチェックボックス自体を
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
      setValidationError("即実施にする検査の実施入力を行ってください。");
      return;
    }

    // 至急のオーダーの予約は取らない。編集では、枠を選び直したぶんだけが入る
    // (選ばなければ空なので、予約は今のままになる)。
    const selected = Object.fromEntries(
      Object.entries(bookings).filter(([code]) =>
        groups.some((line) => line.code === code && line.priority !== "urgent"),
      ),
    );
    const activeBookings = Object.keys(selected).length > 0 ? selected : null;

    setValidationError(null);
    onSubmit(
      {
        ...values,
        authoredDate,
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
  const isSolo = (entry: PhysioOrderEntry) =>
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
        authoredDate: slotDate(slot),
        authoredTime: slotTime(slot),
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
  // テンプレートの既定は検査項目マスタが持つ。記入内容は診療記録(SOAP)と同じく
  // QuestionnaireResponse として保存し、後からテンプレート画面で開き直せる。
  const templateMaster = templateTarget ? catalogByCode.get(templateTarget.code) : undefined;
  const templateCanonical =
    templateTarget?.field === "purpose"
      ? templateMaster?.purpose_template_canonical
      : templateMaster?.remarks_template_canonical;
  // 記入済みの欄を開いたときは、その回答を読み込んで続きから直せるようにする。
  const templateItem = templateTarget
    ? values.items.find((line) => line.code === templateTarget.code)
    : undefined;
  const templateBinding =
    templateTarget && templateItem
      ? templateTarget.field === "purpose"
        ? templateItem.purposeTemplate
        : templateItem.remarksTemplate
      : null;

  return (
    <>
      <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={submitError} />
        <ErrorBanner error={layouts.error ?? setMembers.error ?? catalog.error} />

        <fieldset>
          <legend>検査共通</legend>
          <label>
            対象プロブレム
            <ProblemSelect
              value={values.problem}
              options={problemOptions}
              onChange={(problem) => update("problem", problem)}
            />
          </label>
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
          {/* 至急区分・実施日・実施時刻は伝票共通ではなく「選択中」のオーダー枠ごとに
              入力する(オーダー単位で扱いが変わり、予約必須の項目は予約から日時が
              入るため)。 */}
          {/* 伝票共通の依頼コメントは持たない。1 オーダーの単位が検査項目ごとに
              変わり、伝票全体への申し送りが行き先を持たなくなったため
              (申し送りは GP 単位の特別指示に書く)。 */}
        </fieldset>

        {/* 検査伝票(レイアウト)と検査項目検索の切替。伝票が複数あればその数だけタブが並ぶ。 */}
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
            検査項目検索
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
            <p className="order-select__muted">検査項目を選択してください</p>
          )}

          {/* 1 枠 = 登録される 1 オーダー。まとめられる GP は 1 つの枠に集め、
              単独の項目は項目ごとに枠が分かれる。至急区分・実施日時・即実施は
              オーダー単位の設定なので枠の中に置く。 */}
          {groupedEntries.length > 0 && (
            <OrderFrame
              number={groupedEntries.length > 0 && soloEntries.length > 0 ? 1 : undefined}
              priority={values.priority}
              onChangePriority={(priority) => update("priority", priority)}
              onRemove={() => removeCodes(groupedEntries.map((entry) => entry.item.code))}
              perform={
                editing
                  ? null
                  : {
                      split: splits.find((split) => split.key === "") ?? null,
                      checked: Boolean(performNow[""]),
                      onToggle: (checked) =>
                        setPerformNow((current) => ({ ...current, "": checked })),
                      onOpen: () => setPerformTarget(""),
                      needsInput: (split) => needsPerformInput(split.values.items),
                      canPerform: canPerformNow,
                      summary: performs[""] ? physioPerformSummary(performs[""]) : null,
                    }
              }
              schedule={
                <FrameDateTime
                  date={values.authoredDate}
                  time={values.authoredTime}
                  urgent={values.priority === "urgent"}
                  onChangeDate={(date) => update("authoredDate", date)}
                  onChangeTime={(time) => update("authoredTime", time)}
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
                  onOpenConditionPicker={setConditionTarget}
                  onChange={updateItem}
                  onOpenTemplate={setTemplateTarget}
                />
              ))}
            </OrderFrame>
          )}

          {soloEntries.map((entry, index) => {
            const code = entry.item.code;
            const reserved = requiresBooking(code);
            const booking = bookings[code];
            const urgent = entry.item.priority === "urgent";

            return (
              <OrderFrame
                key={code}
                number={
                  entries.length > 1
                    ? (groupedEntries.length > 0 ? 1 : 0) + index + 1
                    : undefined
                }
                priority={entry.item.priority}
                onChangePriority={(priority) => updateItem(code, { priority })}
                onRemove={() => remove(code)}
                perform={
                  editing
                    ? null
                    : {
                        split: splits.find((split) => split.key === code) ?? null,
                        checked: Boolean(performNow[code]),
                        onToggle: (checked) =>
                          setPerformNow((current) => ({ ...current, [code]: checked })),
                        onOpen: () => setPerformTarget(code),
                        needsInput: (split) => needsPerformInput(split.values.items),
                        canPerform: canPerformNow,
                        summary: performs[code] ? physioPerformSummary(performs[code]) : null,
                      }
                }
                schedule={
                  reserved && !urgent ? (
                    editing ? (
                      // 編集では、予約日時もここから変える(予約タブからは変えない。
                      // オーダーの実施日時と予約を必ず一緒に動かすため)。日時は予約と
                      // 同期しているヘッダの値で、枠を選び直すとその枠の日時になる。
                      <span className="rad-order-frame__booking">
                        <span className="rad-order-frame__booked">
                          実施日時 {values.authoredDate} {values.authoredTime}
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
                      date={editing ? values.authoredDate : urgent ? today() : entry.item.date}
                      time={editing ? values.authoredTime : entry.item.time}
                      urgent={urgent}
                      onChangeDate={(date) =>
                        editing ? update("authoredDate", date) : updateItem(code, { date })
                      }
                      onChangeTime={(time) =>
                        editing ? update("authoredTime", time) : updateItem(code, { time })
                      }
                    />
                  )
                }
              >
                <GroupEditor
                  entry={entry}
                  number={1}
                  solo
                  onRemove={remove}
                  onOpenConditionPicker={setConditionTarget}
                  onChange={updateItem}
                  onOpenTemplate={setTemplateTarget}
                />
              </OrderFrame>
            );
          })}
        </section>

        <div className="prescription-form__submit">
          <button type="submit" disabled={submitting}>
            {submitting ? "送信中..." : submitLabel}
          </button>
        </div>
      </form>

      {/* モーダル内の QuestionnaireResponseForm は独自の <form> を持つため、
          外側フォームの子孫に置かない(form の入れ子は不正で、送信が外へ漏れる)。 */}
      {templateTarget && (
        <TemplateEntryModal
          patientId={patientId}
          draft={templateBinding?.draft ?? null}
          responseId={templateBinding?.responseId ?? null}
          defaultCanonical={templateCanonical ?? undefined}
          onSubmit={(draft) => {
            const text = questionnaireResponsePlainText(draft.questionnaire, draft.response);
            // 保存済みの回答を再編集した場合は同じ id へ書き戻す(id は保存時に使う)。
            const binding: TemplateBinding = {
              responseId: templateBinding?.responseId ?? null,
              draft,
            };
            updateItem(
              templateTarget.code,
              templateTarget.field === "purpose"
                ? { purpose: text, purposeTemplate: binding }
                : { remarks: text, remarksTemplate: binding },
            );
            setTemplateTarget(null);
          }}
          onClose={() => setTemplateTarget(null)}
        />
      )}

      {/* 依頼病名の選択。Modal はポータルではないので、外側フォームの中に置くと
          モーダル内の操作が外側フォームのイベントに乗る。他のモーダルと同じく外へ出す。 */}
      {conditionTarget && (
        <ConditionPickerModal
          patientId={patientId}
          title="依頼病名を選択"
          onSelect={({ conditionId, name }) => {
            updateItem(conditionTarget, { reasonConditionId: conditionId, reasonName: name });
            setConditionTarget(null);
          }}
          onClose={() => setConditionTarget(null)}
        />
      )}

      {/* 実施入力も独自の <form> を持つので、テンプレートと同じく外側フォームの外に置く。 */}
      {performSplit && (
        <PhysioPerformInputModal
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

      {/* 検査予約。ここでは枠を選ぶだけで、予約が書かれるのはオーダー登録のとき
          (同じ transaction に同梱)。登録をやめれば予約も残らない。 */}
      {bookingTarget && (
        <Modal
          title={`検査予約: ${catalogByCode.get(bookingTarget)?.name ?? bookingTarget}`}
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
              // 項目マスタに紐づけた枠表(CT なら CT 室の枠、など)を最初から選んでおく。
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
  split: PhysioOrderSplit | null;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  onOpen: () => void;
  needsInput: (split: PhysioOrderSplit) => boolean;
  canPerform: (split: PhysioOrderSplit) => boolean;
  summary: string | null;
}

/**
 * 登録される 1 オーダーぶんの枠。至急区分・実施日時(または予約)・即実施という
 * オーダー単位の設定を上下に置き、間に GP を並べる。
 */
function OrderFrame({
  number,
  priority,
  onChangePriority,
  schedule,
  perform,
  onRemove,
  children,
}: {
  /** オーダーが複数に分かれるときだけ振る通し番号。1 件なら付けない。 */
  number?: number;
  priority: PhysioOrderPriority;
  onChangePriority: (priority: PhysioOrderPriority) => void;
  /** 実施日時の入力、または予約の操作。 */
  schedule: ReactNode;
  perform: FramePerform | null;
  /** このオーダー(枠内の検査項目すべて)を選択から外す。 */
  onRemove: () => void;
  children: ReactNode;
}) {
  const split = perform?.split ?? null;
  // 予約必須の検査を含む非至急オーダーは、登録と同時に実施済にできない。
  const canPerform = split ? perform?.canPerform(split) : false;

  return (
    <div className="rad-order-frame">
      <div className="rad-order-frame__head">
        {number !== undefined && <span className="rad-order-frame__number">{number}</span>}
        <label className="rad-order-frame__priority">
          至急区分
          <select
            value={priority}
            onChange={(e) => onChangePriority(e.target.value as PhysioOrderPriority)}
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        {schedule}
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
            <span className="order-select__muted">予約する検査は即実施にできません</span>
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
                実施入力のない検査です(実施済にします)
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * オーダー枠の実施日・実施時刻。時刻は部門側に任せる場合は未入力でよい任意入力。
 * 至急のオーダーは当日実施に固定する。
 */
function FrameDateTime({
  date,
  time,
  urgent,
  onChangeDate,
  onChangeTime,
}: {
  date: string;
  time: string;
  urgent?: boolean;
  onChangeDate: (date: string) => void;
  onChangeTime: (time: string) => void;
}) {
  return (
    <span className="rad-order-frame__datetime">
      <label>
        実施日
        <input
          type="date"
          value={date}
          disabled={urgent}
          onChange={(e) => onChangeDate(e.target.value)}
        />
      </label>
      <label>
        実施時刻
        <input type="time" value={time} onChange={(e) => onChangeTime(e.target.value)} />
      </label>
      {urgent && <span className="rad-order-frame__note">当日実施</span>}
    </span>
  );
}

// GP 1 つぶんの確認と記入。セットなら構成する検査を並べ、依頼病名・検査目的・
// 特別指示は GP 単位で入力する(FHIR では GP を表す明細に載る)。
function GroupEditor({
  entry,
  number,
  solo,
  onRemove,
  onChange,
  onOpenTemplate,
  onOpenConditionPicker,
}: {
  entry: PhysioOrderEntry;
  number: number;
  /** 単独オーダーの項目(登録時にこの GP だけで 1 オーダーになる)。 */
  solo: boolean;
  onRemove: (code: string) => void;
  onChange: (code: string, patch: Partial<PhysioOrderItemLine>) => void;
  onOpenTemplate: (target: TemplateTarget) => void;
  onOpenConditionPicker: (code: string) => void;
}) {
  const { item, members } = entry;
  const examType = entryExamTypeName(entry);

  return (
    <div className="rad-gp">
      <div className="rad-gp__head">
        <span className="rad-gp__number">GP{number}</span>
        <span className="rad-gp__name">{item.name}</span>
        {solo && <span className="dose-conversion__badge">単独</span>}
        {examType && <span className="order-select__muted">{examType}</span>}
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

      <div className="rad-gp__fields">
        <label>
          依頼病名
          <div className="rad-gp__reason">
            <input
              type="text"
              value={item.reasonName}
              placeholder="病名を直接入力"
              // 手で書き換えたら登録病名との紐付けは外す(別の文言になるため)。
              onChange={(e) =>
                onChange(item.code, { reasonName: e.target.value, reasonConditionId: "" })
              }
              aria-label="依頼病名"
            />
            {/* 登録済みの病名から写す。候補が数十件になっても選べるよう、
                絞り込みのできるモーダルで選ぶ(プルダウンでは探せない)。 */}
            <div className="rad-gp__reason-actions">
              <button
                type="button"
                onClick={() => onOpenConditionPicker(item.code)}
                title="登録されている病名から選ぶ"
              >
                病名
              </button>
            </div>
          </div>
        </label>

        <TemplateTextField
          label="検査目的"
          value={item.purpose}
          template={item.purposeTemplate}
          onChange={(purpose) => onChange(item.code, { purpose })}
          onOpenTemplate={() => onOpenTemplate({ code: item.code, field: "purpose" })}
          onClearTemplate={() => onChange(item.code, { purposeTemplate: null })}
        />
        <TemplateTextField
          label="特別指示"
          value={item.remarks}
          template={item.remarksTemplate}
          onChange={(remarks) => onChange(item.code, { remarks })}
          onOpenTemplate={() => onOpenTemplate({ code: item.code, field: "remarks" })}
          onClearTemplate={() => onChange(item.code, { remarksTemplate: null })}
        />
      </div>
    </div>
  );
}

// テンプレートからも直接入力もできる欄。テンプレートから記載した場合は、回答との
// 食い違いを防ぐため直接編集は不可にし、直すときはテンプレート画面を開き直す
// (診療記録の SOAP セクションと同じ扱い)。
//
// 「解除」でテンプレートとの紐付けを外すと、記載された文言を残したまま直接入力へ戻せる。
// 保存すると、参照が外れた記入内容(QuestionnaireResponse)はオーダーの更新と同じ
// transaction で削除される。
function TemplateTextField({
  label,
  value,
  template,
  onChange,
  onOpenTemplate,
  onClearTemplate,
}: {
  label: string;
  value: string;
  template: TemplateBinding | null;
  onChange: (value: string) => void;
  onOpenTemplate: () => void;
  onClearTemplate: () => void;
}) {
  const fromTemplate = Boolean(template);

  return (
    <label>
      {label}
      <div className="rad-gp__template-field">
        <textarea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={fromTemplate}
          title={
            fromTemplate ? "テンプレートから記載した内容です。テンプレート編集から直します" : undefined
          }
        />
        <div className="rad-gp__template-actions">
          <button
            type="button"
            onClick={onOpenTemplate}
            title={fromTemplate ? `${label}をテンプレートから直す` : `${label}をテンプレートから記入`}
          >
            {fromTemplate ? "テンプレート編集" : "テンプレート"}
          </button>
          {fromTemplate && (
            <button
              type="button"
              onClick={onClearTemplate}
              title="テンプレートとの紐付けを外して直接入力に戻す(記載された文言は残る)"
            >
              解除
            </button>
          )}
        </div>
      </div>
      {/* 記入内容にシェーマ画像があれば、平文の「あり」の印だけでは何を描いたか
          分からないので、入力中もサムネイルを出す(登録後の表示と同じ見せ方)。 */}
      <TemplateSchemaImages template={template} />
    </label>
  );
}

interface SelectProps {
  selectedCodes: ReadonlySet<string>;
  onToggle: (item: PhysioItem) => void;
}

// 検査伝票のグリッド。マス割りはレイアウトマスタの定義そのままで、
// 検査項目のマスにチェックボックスを重ねる。
function LayoutSelectGrid({
  layout,
  error,
  catalogByCode,
  selectedCodes,
  onToggle,
}: SelectProps & {
  layout: ReturnType<typeof usePhysioItemLayout>["data"];
  error: unknown;
  catalogByCode: Map<string, PhysioItem>;
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
                        // マスタ行が届く前に押されると JJ1017 コードが空のまま入って
                        // しまうので、揃うまでは押せないようにする。
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
  const result = usePhysioItemSearch({ name, active: true }, page, name.trim().length > 0);

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
              <li className="order-select__muted">該当する検査項目がありません</li>
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
