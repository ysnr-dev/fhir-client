import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { RadItem } from "../api/masterClient";
import {
  elementName,
  useRadItemLayout,
  useRadItemLayouts,
  useRadItemSearch,
  useRadItemsByCodes,
  useRadSetMembers,
} from "../api/masterQueries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  questionnaireResponsePlainText,
  type TemplateBinding,
} from "../fhir/questionnaireResponseHelpers";
import {
  PRIORITY_OPTIONS,
  bodySiteLabel,
  emptyRadOrderForm,
  entryModalityName,
  orderEntries,
  topLevelItems,
  type RadOrderEntry,
  type RadOrderFormValues,
  type RadOrderItemLine,
  type RadOrderPriority,
} from "../fhir/radOrderHelpers";
import { useConditionOptions } from "../hooks/useConditionOptions";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { TemplateEntryModal } from "./TemplateEntryModal";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";
import { TemplateSchemaImages } from "./SchemaImageGallery";

// 放射線検査オーダーの入力フォーム。撮影伝票(放射線オーダーレイアウト)のタブと
// 個別検索から項目を選び、選んだ内容を GP ごとに確認・記入してから登録する。
//
// 1 GP = 単独で選んだ撮影項目 1 つ、またはセット 1 つ。セットは親を GP とし、
// 構成する撮影は GP の中身として並べる。FHIR には検体検査のパネルと同じく
// セット親と構成項目を親子の ServiceRequest で保存する。
//
// GP ごとに依頼病名・検査目的・特別指示を入力する。検査目的と特別指示は診療記録の
// SOAP と同じテンプレート(Questionnaire)から記入でき、撮影項目マスタに既定の
// テンプレートが設定してあればそれを最初から選んだ状態で開く。
//
// 選んだ項目は、オーダー時点のマスタの内容(名称・JJ1017 コード・種別・部位・左右)を
// 写して持つ。マスタを直しても過去のオーダーの中身が変わらないようにするため。

interface RadOrderFormProps {
  patientId: string;
  initialValues?: RadOrderFormValues;
  onSubmit: (values: RadOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /**
   * 保存済みオーダーの編集。更新は 1 つのヘッダへの書き戻しなのでオーダーを
   * 分けられず、単独の項目を他の項目と同居させられない(新規登録は分けられる)。
   */
  editing?: boolean;
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

export function RadOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  editing = false,
}: RadOrderFormProps) {
  const [values, setValues] = useState<RadOrderFormValues>(initialValues ?? emptyRadOrderForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));
  const [active, setActive] = useState<ActiveTab | null>(null);
  const [searchCodes, setSearchCodes] = useState<string[]>([]);
  const [templateTarget, setTemplateTarget] = useState<TemplateTarget | null>(null);
  // 構成項目を入れ終えたセット。保存済みオーダーを開いたときは、登録時に外した
  // 構成項目が復活しないよう、最初から入っているセットを入れ終わり扱いにする。
  const expandedSets = useRef<Set<string>>(
    new Set(topLevelItems(initialValues?.items ?? []).map((item) => item.code)),
  );

  const problemOptions = useProblemOptions(patientId);
  const conditionOptions = useConditionOptions(patientId);
  const layouts = useRadItemLayouts();

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
  const layout = useRadItemLayout(active?.kind === "layout" ? active.id : undefined);
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

  const setMembers = useRadSetMembers(catalogCodes);
  // 構成項目もオーダーに写すので、マスタ行は構成項目のぶんまで引く。
  const memberCodes = useMemo(
    () => Array.from(setMembers.data?.values() ?? []).flat(),
    [setMembers.data],
  );
  const catalog = useRadItemsByCodes([...catalogCodes, ...memberCodes]);
  const catalogByCode = useMemo(() => {
    const map = new Map<string, RadItem>();
    for (const item of catalog.data?.items ?? []) map.set(item.item_code, item);
    return map;
  }, [catalog.data]);

  // マスタの放射線オーダー項目を、オーダーに写す 1 行に変換する。要素コードの名称は
  // 一覧APIが添えて返すもの(elements)を使うので、追加の取得はいらない。
  const catalogResult = catalog.data;
  const buildLine = useCallback(
    (item: RadItem, parentCode: string): RadOrderItemLine => ({
      // 画面で足した項目は登録時に採番されるので、この時点では id を持たない。
      id: "",
      code: item.item_code,
      name: item.name,
      shortName: item.short_name ?? "",
      jj1017Code: item.jj1017_code ?? "",
      modalityCode: item.modality_code ?? "",
      modalityName: elementName(catalogResult, "modality", item.modality_code),
      bodyPartCode: item.body_part_code ?? "",
      bodyPartName: elementName(catalogResult, "body_part", item.body_part_code),
      lateralityCode: item.laterality_code ?? "",
      lateralityName: elementName(catalogResult, "laterality", item.laterality_code),
      reasonConditionId: "",
      reasonName: "",
      purpose: "",
      remarks: "",
      purposeTemplate: null,
      remarksTemplate: null,
      parentCode,
      groupable: item.groupable,
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
        .filter((row): row is RadItem => Boolean(row));
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

  function update<K extends keyof RadOrderFormValues>(key: K, value: RadOrderFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function updateItem(code: string, patch: Partial<RadOrderItemLine>) {
    setValues((current) => ({
      ...current,
      items: current.items.map((line) => (line.code === code ? { ...line, ...patch } : line)),
    }));
  }

  // 撮影項目の選択・解除。セットを外すと構成項目も一緒に外れ、構成項目だけを外すと
  // そのセットからその撮影を除いたオーダーになる。
  function toggle(item: RadItem) {
    const code = item.item_code;
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

  function remove(code: string) {
    setValues((current) => {
      expandedSets.current.delete(code);
      return {
        ...current,
        items: current.items.filter((line) => line.code !== code && line.parentCode !== code),
      };
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (values.items.length === 0) {
      setValidationError("撮影項目を 1 つ以上選択してください。");
      return;
    }
    if (!values.authoredDate) {
      setValidationError("撮影日を入力してください。");
      return;
    }

    // 単独オーダーかどうかは登録時点のマスタで決める(保存済みのオーダーを開いた
    // ときは明細から復元できないため)。マスタから消えた項目は今の値のままにする。
    const items = values.items.map((line) =>
      line.parentCode
        ? line
        : { ...line, groupable: catalogByCode.get(line.code)?.groupable ?? line.groupable },
    );

    const groups = topLevelItems(items);
    const solo = groups.find((line) => !line.groupable);
    if (editing && solo && groups.length > 1) {
      setValidationError(
        `単独オーダーの項目「${solo.name}」は他の撮影項目と同じオーダーにできません。`,
      );
      return;
    }

    setValidationError(null);
    onSubmit({ ...values, items, problem: refreshProblemDisplay(values.problem, problemOptions) });
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
  const isSolo = (entry: RadOrderEntry) =>
    !(catalogByCode.get(entry.item.code)?.groupable ?? entry.item.groupable);
  const soloCount = entries.filter(isSolo).length;
  // 単独の項目はそれぞれ 1 オーダー。残りはまとめて 1 オーダー。
  const orderCount = soloCount + (entries.length > soloCount ? 1 : 0);
  // テンプレートの既定は撮影項目マスタが持つ。記入内容は診療記録(SOAP)と同じく
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
          <label>
            至急区分
            <select
              value={values.priority}
              onChange={(e) => update("priority", e.target.value as RadOrderPriority)}
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            撮影日
            <input
              type="date"
              value={values.authoredDate}
              onChange={(e) => update("authoredDate", e.target.value)}
            />
          </label>
          <label>
            撮影時刻
            {/* 日付は撮影日を使うので時刻だけを入力する(注射の開始時刻と同じ)。
                時間帯を撮影側に任せる場合は未入力でよいので任意入力。 */}
            <input
              type="time"
              value={values.authoredTime}
              onChange={(e) => update("authoredTime", e.target.value)}
            />
          </label>
          {commentOpen ? (
            <div className="prescription-form__comment-field">
              <label>
                依頼コメント
                <input
                  type="text"
                  value={values.comment}
                  onChange={(e) => update("comment", e.target.value)}
                  placeholder="オーダー全体への申し送り"
                />
              </label>
              <button
                type="button"
                className="rp-card__icon-button"
                title="依頼コメントを削除"
                aria-label="依頼コメントを削除"
                onClick={() => {
                  setCommentOpen(false);
                  update("comment", "");
                }}
              >
                <TrashIcon />
              </button>
            </div>
          ) : (
            <div className="prescription-form__comment-toggle">
              <button
                type="button"
                className="comment-add-button"
                onClick={() => setCommentOpen(true)}
              >
                ＋依頼コメント
              </button>
            </div>
          )}
        </fieldset>

        {/* 撮影伝票(レイアウト)と撮影項目検索の切替。伝票が複数あればその数だけタブが並ぶ。 */}
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
            撮影項目検索
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
            <p className="order-select__muted">撮影項目を選択してください</p>
          )}
          {/* 単独の項目を混ぜて選べるようにしつつ、登録するとカルテのカードが
              分かれることを選択中の時点で知らせる。 */}
          {!editing && orderCount > 1 && (
            <p className="order-select__muted">
              単独の項目はそれぞれ別のオーダーになるため、{orderCount} 件のオーダーとして登録されます
            </p>
          )}
          {entries.map((entry, index) => (
            <GroupEditor
              key={entry.item.code}
              entry={entry}
              number={index + 1}
              solo={isSolo(entry)}
              conditionOptions={conditionOptions}
              onRemove={remove}
              onChange={updateItem}
              onOpenTemplate={setTemplateTarget}
            />
          ))}
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
    </>
  );
}

// GP 1 つぶんの確認と記入。セットなら構成する撮影を並べ、依頼病名・検査目的・
// 特別指示は GP 単位で入力する(FHIR では GP を表す明細に載る)。
function GroupEditor({
  entry,
  number,
  solo,
  conditionOptions,
  onRemove,
  onChange,
  onOpenTemplate,
}: {
  entry: RadOrderEntry;
  number: number;
  /** 単独オーダーの項目(登録時にこの GP だけで 1 オーダーになる)。 */
  solo: boolean;
  conditionOptions: ProblemRef[];
  onRemove: (code: string) => void;
  onChange: (code: string, patch: Partial<RadOrderItemLine>) => void;
  onOpenTemplate: (target: TemplateTarget) => void;
}) {
  const { item, members } = entry;
  const modality = entryModalityName(entry);
  const site = bodySiteLabel(item);
  // 保存済みの依頼病名が候補に無い(病名を消した)場合も、選択を失わせない。
  const missingCondition =
    Boolean(item.reasonConditionId) &&
    !conditionOptions.some((o) => o.conditionId === item.reasonConditionId);

  return (
    <div className="rad-gp">
      <div className="rad-gp__head">
        <span className="rad-gp__number">GP{number}</span>
        <span className="rad-gp__name">{item.name}</span>
        {solo && <span className="dose-conversion__badge">単独</span>}
        {modality && <span className="order-select__muted">{modality}</span>}
        {site && <span className="order-select__muted">{site}</span>}
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
              {bodySiteLabel(member) && (
                <span className="order-select__muted">{bodySiteLabel(member)}</span>
              )}
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
            <select
              value={item.reasonConditionId}
              onChange={(e) => {
                const conditionId = e.target.value;
                const option = conditionOptions.find((o) => o.conditionId === conditionId);
                onChange(item.code, {
                  reasonConditionId: conditionId,
                  // 選び直したら病名も入れ替える。直接入力に戻したときは文字列を残す。
                  reasonName: option ? option.display : item.reasonName,
                });
              }}
              aria-label="登録病名から選ぶ"
            >
              <option value="">(直接入力)</option>
              {conditionOptions.map((option) => (
                <option key={option.conditionId} value={option.conditionId}>
                  {option.display}
                </option>
              ))}
              {missingCondition && (
                <option value={item.reasonConditionId}>
                  {item.reasonName || "(不明)"} (削除済み)
                </option>
              )}
            </select>
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
  onToggle: (item: RadItem) => void;
}

// 撮影伝票のグリッド。マス割りはレイアウトマスタの定義そのままで、
// 撮影項目のマスにチェックボックスを重ねる。
function LayoutSelectGrid({
  layout,
  error,
  catalogByCode,
  selectedCodes,
  onToggle,
}: SelectProps & {
  layout: ReturnType<typeof useRadItemLayout>["data"];
  error: unknown;
  catalogByCode: Map<string, RadItem>;
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
  const result = useRadItemSearch({ name, active: true }, page, name.trim().length > 0);

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
              <li className="order-select__muted">該当する撮影項目がありません</li>
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
