import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { LabItem } from "../api/masterClient";
import {
  emptyLabResultForm,
  emptyLabResultLine,
  parseCodeValueList,
  SETTING_OPTIONS,
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
}

type ModalState = { lineIndex: number } | null;

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

export function LabResultForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: LabResultFormProps) {
  const [values, setValues] = useState<LabResultFormValues>(initialValues ?? emptyLabResultForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  function update<K extends keyof LabResultFormValues>(key: K, value: LabResultFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

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
        <label>
          検体採取日
          <input
            type="date"
            value={values.specimenDate}
            onChange={(e) => update("specimenDate", e.target.value)}
          />
        </label>
      </fieldset>

      <fieldset className="rp-card">
        <legend>検査項目</legend>

        <table className="rp-card__medicines">
          <colgroup>
            <col />
            <col style={{ width: "18%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "160px" }} />
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
                  <ResultValueInput
                    line={line}
                    onChange={(value) => updateLine(lineIndex, { value })}
                  />
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
