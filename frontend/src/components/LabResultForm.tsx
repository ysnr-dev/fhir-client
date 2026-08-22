import { makeFieldUpdater } from "../lib/form";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useSelfDepartments, type LabOrderCandidate } from "../api/queries";
import type { LabItem } from "../api/masterClient";
import {
  useLabOrderResultLines,
  type ExpandedResultLine,
} from "../hooks/useLabOrderResultLines";
import {
  emptyLabResultForm,
  emptyLabResultLine,
  INTERPRETATION_OPTIONS,
  parseCodeValueList,
  SETTING_OPTIONS,
  type LabInterpretation,
  type LabResultFormValues,
  type LabResultLineValues,
  type LabResultSetting,
} from "../fhir/labResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { LabItemSearchModal } from "./LabItemSearchModal";

interface LabResultFormProps {
  initialValues?: LabResultFormValues;
  onSubmit: (values: LabResultFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /** 紐付けられる検体検査オーダー(結果が未登録のもの)。 */
  orderCandidates: LabOrderCandidate[];
  orderCandidatesLoading: boolean;
  /**
   * 紐付け先のオーダーが決まっている場合の表示。検体検査一覧からの結果登録では
   * 行のオーダーに必ず紐付くので、選ばせずにこの文字列を出す。
   */
  lockedOrderLabel?: string;
}

type ModalState = { lineIndex: number } | null;

/**
 * オーダーから展開した項目を、いま入力中の行に反映する。
 * ・並びはオーダーの項目順にし、すでに入力済みの結果値(と Observation の id)は引き継ぐ
 * ・オーダーに含まれない項目でも、結果値が入っていれば消さずに後ろへ残す
 */
function mergeExpandedLines(
  current: LabResultLineValues[],
  expanded: ExpandedResultLine[],
): LabResultLineValues[] {
  const currentByCode = new Map(
    current.flatMap((line) => (line.item ? [[line.item.jlac11_code, line] as const] : [])),
  );
  const expandedCodes = new Set(expanded.map((line) => line.item.jlac11_code));

  const merged = expanded.map((line) => {
    const existing = currentByCode.get(line.item.jlac11_code);
    return existing ? { ...existing, item: line.item } : line;
  });
  const kept = current.filter(
    (line) => line.item && line.value && !expandedCodes.has(line.item.jlac11_code),
  );

  return [...merged, ...kept];
}

// データタイプに応じた結果値入力。PQ: 数値 / CD・CO: 選択肢 / ST(その他): 文字列
function ResultValueInput({
  line,
  onChange,
}: {
  line: LabResultLineValues;
  onChange: (value: string) => void;
}) {
  const item = line.item;
  if (!item) {
    return <input type="text" value={line.value} disabled />;
  }

  if (item.data_type === "PQ") {
    return (
      <input
        type="number"
        step="any"
        value={line.value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (item.data_type === "CD" || item.data_type === "CO") {
    const options = parseCodeValueList(item.code_value_list);
    if (options.length > 0) {
      return (
        <select value={line.value} onChange={(e) => onChange(e.target.value)}>
          <option value="">選択してください</option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
      );
    }
  }

  return <input type="text" value={line.value} onChange={(e) => onChange(e.target.value)} />;
}

// 展開できなかった項目の名前を並べる上限(残りは「他N件」)。
const NOTICE_NAME_COUNT = 5;

function expandNoticeOf(lineCount: number, unmatchedNames: string[]): string | null {
  if (lineCount === 0 && unmatchedNames.length === 0) return null;

  const expanded = lineCount > 0 ? `オーダーの検査項目 ${lineCount} 件を展開しました。` : "";
  if (unmatchedNames.length === 0) return expanded;

  const shown = unmatchedNames.slice(0, NOTICE_NAME_COUNT).join("、");
  const rest =
    unmatchedNames.length > NOTICE_NAME_COUNT
      ? ` 他${unmatchedNames.length - NOTICE_NAME_COUNT}件`
      : "";
  return `${expanded}JLACコードから検査項目マスタを引けなかったため、次の項目は展開していません: ${shown}${rest}`;
}

export function LabResultForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  orderCandidates,
  orderCandidatesLoading,
  lockedOrderLabel,
}: LabResultFormProps) {
  const [values, setValues] = useState<LabResultFormValues>(initialValues ?? emptyLabResultForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const { departments } = useSelfDepartments();

  // 画面上でオーダーを選び直したときだけ検査項目を展開する(初期表示時の
  // 紐付け済みオーダーで、保存済みの検査項目を上書きしてしまわないようにする)。
  const [expandingOrderId, setExpandingOrderId] = useState("");
  const [expandNotice, setExpandNotice] = useState<string | null>(null);
  const expansion = useLabOrderResultLines(expandingOrderId || undefined);

  useEffect(() => {
    if (!expandingOrderId || !expansion.ready) return;
    setExpandingOrderId("");

    if (expansion.lines.length > 0) {
      setValues((v) => ({ ...v, lines: mergeExpandedLines(v.lines, expansion.lines) }));
    }
    setExpandNotice(expandNoticeOf(expansion.lines.length, expansion.unmatchedNames));
  }, [expandingOrderId, expansion.ready, expansion.lines, expansion.unmatchedNames]);

  const update = makeFieldUpdater(setValues);

  function updateLine(lineIndex: number, patch: Partial<LabResultLineValues>) {
    setValues((v) => ({
      ...v,
      lines: v.lines.map((line, i) => (i === lineIndex ? { ...line, ...patch } : line)),
    }));
  }

  function addLine() {
    if (values.lines.some((line) => !line.item)) {
      setValidationError("検査項目が未選択のレコードがあります。選択してから追加してください。");
      return;
    }
    setValidationError(null);
    const newLineIndex = values.lines.length;
    setValues((v) => ({ ...v, lines: [...v.lines, { ...emptyLabResultLine }] }));
    setModal({ lineIndex: newLineIndex });
  }

  function removeLine(lineIndex: number) {
    setValues((v) => ({ ...v, lines: v.lines.filter((_, i) => i !== lineIndex) }));
  }

  // オーダーを選び直したら、その JLAC コードから検査項目を展開し直す。
  // 診療科はオーダーの依頼科を採用する(オーダーと違う科の結果にならないよう、
  // 紐付けている間は選び直せない)。
  function handleOrderChange(orderId: string) {
    const candidate = orderCandidates.find((c) => c.id === orderId);
    setValues((v) => ({
      ...v,
      orderId,
      ...(candidate
        ? { departmentId: candidate.departmentId, departmentName: candidate.departmentName }
        : {}),
    }));
    setExpandNotice(null);
    setExpandingOrderId(orderId);
  }

  function handleDepartmentChange(departmentId: string) {
    const department = departments.find((d) => d.id === departmentId);
    setValues((v) => ({
      ...v,
      departmentId,
      departmentName: departmentId ? (department?.name ?? v.departmentName) : "",
    }));
  }

  function handleItemSelect(item: LabItem) {
    if (!modal) return;
    // データタイプ・選択肢が変わるため、項目を変更したら結果値はクリアする。
    updateLine(modal.lineIndex, { item, value: "" });
    setModal(null);
  }

  function validate(): string | null {
    if (!values.specimenDate) return "検体採取日は必須です。";
    if (!values.setting) return "入外区分は必須です。";
    if (values.lines.length === 0) return "検査項目を1件以上登録してください。";

    for (let i = 0; i < values.lines.length; i++) {
      const line = values.lines[i];
      const label = `${i + 1}行目`;
      if (!line.item) return `${label}: 検査項目を選択してください。`;
      if (!line.value) return `${label}: 結果値を入力してください。`;
      if (line.item.data_type === "PQ" && Number.isNaN(Number(line.value))) {
        return `${label}: 結果値は数値で入力してください。`;
      }
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    onSubmit(values);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  return (
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />
      <ErrorBanner error={expansion.error} />

      <fieldset>
        <legend>検査共通</legend>
        <label>
          入外区分
          <select
            value={values.setting}
            onChange={(e) => update("setting", e.target.value as LabResultSetting)}
          >
            <option value="">選択してください</option>
            {SETTING_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        {/* オーダーに紐付けている間は、オーダーの依頼科を採用するので選び直せない。 */}
        <label>
          診療科
          <select
            value={values.departmentId}
            onChange={(e) => handleDepartmentChange(e.target.value)}
            disabled={Boolean(values.orderId)}
          >
            <option value="">選択してください</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
            {/* マスタの読み込み前や、診療科が削除された場合に選択が空へ化けないようにする。 */}
            {values.departmentId &&
              !departments.some((department) => department.id === values.departmentId) && (
                <option value={values.departmentId}>
                  {values.departmentName || "(削除済みの診療科)"}
                </option>
              )}
          </select>
        </label>
        <label>
          検体採取日
          <input
            type="date"
            value={values.specimenDate}
            onChange={(e) => update("specimenDate", e.target.value)}
          />
        </label>
        {/*
          元になった検体検査オーダー。紐付けは検査項目単位ではなくオーダー単位で、
          すでに結果が登録されているオーダーは候補に出ない(編集中の結果自身が
          紐付けているオーダーだけは残る)。
        */}
        <label className="lab-result-form__order">
          検体検査オーダー
          {lockedOrderLabel ? (
            <span className="lab-result-form__order-locked">{lockedOrderLabel}</span>
          ) : (
            <select
              value={values.orderId}
              onChange={(e) => handleOrderChange(e.target.value)}
              disabled={orderCandidatesLoading}
            >
              <option value="">紐付けなし</option>
              {orderCandidatesLoading && values.orderId && (
                <option value={values.orderId}>読み込み中...</option>
              )}
              {orderCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
              {/* 紐付け先のオーダーが削除されている場合に、選択が空へ化けないようにする。 */}
              {!orderCandidatesLoading &&
                values.orderId &&
                !orderCandidates.some((candidate) => candidate.id === values.orderId) && (
                  <option value={values.orderId}>(削除済みのオーダー)</option>
                )}
            </select>
          )}
        </label>
        {expandingOrderId && <p className="lab-result-form__notice">検査項目を展開中...</p>}
        {!expandingOrderId && expandNotice && (
          <p className="lab-result-form__notice">{expandNotice}</p>
        )}
      </fieldset>

      <fieldset className="rp-card">
        <legend>検査項目</legend>

        <table className="rp-card__medicines">
          <colgroup>
            <col />
            <col style={{ width: "18%" }} />
            <col style={{ width: "18%" }} />
            {/* 結果値入力 + H/L プルダウンの2つが並ぶ分の幅。 */}
            <col style={{ width: "220px" }} />
            <col style={{ width: "96px" }} />
            <col style={{ width: "72px" }} />
          </colgroup>
          <thead>
            <tr>
              <th>検査項目</th>
              <th>略称</th>
              <th>材料</th>
              <th>結果値</th>
              <th>単位</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {values.lines.map((line, lineIndex) => (
              <tr key={lineIndex}>
                <td>
                  <div className="rp-card__medicine-cell">
                    <button type="button" onClick={() => setModal({ lineIndex })}>
                      {line.item ? "変更" : "選択"}
                    </button>
                    {line.item ? (
                      <span className="rp-card__medicine-name">{line.item.fhir_item_name}</span>
                    ) : (
                      <span className="rp-card__usage-value--empty">未選択</span>
                    )}
                  </div>
                </td>
                <td>{line.item?.abbreviation ?? "-"}</td>
                <td>{line.item?.jlac11_specimen ?? "-"}</td>
                <td>
                  <div className="lab-result-form__value-cell">
                    <ResultValueInput
                      line={line}
                      onChange={(value) => updateLine(lineIndex, { value })}
                    />
                    {/* H/L 判定。未選択(空)は FHIR 上 "N" として記録される。 */}
                    <select
                      className="lab-result-form__interpretation"
                      value={line.interpretation}
                      onChange={(e) =>
                        updateLine(lineIndex, {
                          interpretation: e.target.value as LabInterpretation,
                        })
                      }
                      aria-label="H/L判定"
                    >
                      <option value=""></option>
                      {INTERPRETATION_OPTIONS.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td>{line.item?.data_type === "PQ" ? line.item.display_unit || "-" : "-"}</td>
                <td>
                  {values.lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(lineIndex)}>
                      削除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="rp-card__actions">
          <button type="button" onClick={addLine}>
            + 検査項目追加
          </button>
        </div>
      </fieldset>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>

      {modal && (
        <LabItemSearchModal onSelect={handleItemSelect} onClose={() => setModal(null)} />
      )}
    </form>
  );
}
