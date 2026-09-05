import { useState, type FormEvent } from "react";
import {
  emptyInfectionForm,
  INFECTION_RESULT_OPTIONS,
  INFECTION_SOURCE_OPTIONS,
  INFECTION_TYPES,
  type InfectionFormValues,
  type InfectionResult,
  type InfectionSource,
  type InfectionType,
} from "../fhir/infectionHelpers";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";

interface InfectionFormProps {
  initialValues?: InfectionFormValues;
  onSubmit: (values: InfectionFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  /** 編集のときだけ削除できる。 */
  onDelete?: () => void;
  deleting?: boolean;
}

// 手入力の感染症。検査していないが他院情報・本人申告で分かっている分を書く。
// 検査で出た結果はこの画面では直せない(正本は検査結果側)。
export function InfectionForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  onDelete,
  deleting = false,
}: InfectionFormProps) {
  const [values, setValues] = useState<InfectionFormValues>(initialValues ?? emptyInfectionForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  const update = makeFieldUpdater(setValues);
  const editing = Boolean(initialValues);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!values.type) {
      setValidationError("種類を選択してください。");
      return;
    }
    if (!values.result) {
      setValidationError("結果を選択してください。");
      return;
    }

    setValidationError(null);
    onSubmit(values);
  }

  return (
    <form className="patient-fields" onSubmit={handleSubmit}>
      <fieldset className="patient-fields__group-box">
        <legend>感染症(手入力)</legend>

        <div className="patient-fields__row">
          <label>
            種類
            <select
              value={values.type}
              onChange={(e) => update("type", e.target.value as InfectionType | "")}
              // 種類を変えると別の記録になるので、編集では変えさせない。
              disabled={editing}
            >
              <option value="">選択してください</option>
              {INFECTION_TYPES.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            結果
            <select
              value={values.result}
              onChange={(e) => update("result", e.target.value as InfectionResult | "")}
            >
              <option value="">選択してください</option>
              {INFECTION_RESULT_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            情報源
            <select
              value={values.source}
              onChange={(e) => update("source", e.target.value as InfectionSource)}
            >
              {INFECTION_SOURCE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            確認日
            <input
              type="date"
              value={values.effectiveDate}
              onChange={(e) => update("effectiveDate", e.target.value)}
            />
          </label>
        </div>

        <div className="patient-fields__row">
          <label className="patient-fields__field--wide">
            備考
            <input type="text" value={values.note} onChange={(e) => update("note", e.target.value)} />
          </label>
        </div>
      </fieldset>

      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <ErrorBanner error={submitError} />

      <div className="patient-fields__actions">
        <button type="submit" disabled={submitting}>
          保存
        </button>
        {onDelete && (
          <button type="button" onClick={onDelete} disabled={deleting}>
            削除
          </button>
        )}
      </div>
    </form>
  );
}
