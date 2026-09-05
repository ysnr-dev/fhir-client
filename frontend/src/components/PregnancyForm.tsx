import { useState, type FormEvent } from "react";
import {
  emptyPregnancyForm,
  LACTATION_STATUS_OPTIONS,
  PREGNANCY_STATUS_OPTIONS,
  PREGNANT_CODE,
  type LactationStatus,
  type PregnancyFormValues,
  type PregnancyStatus,
} from "../fhir/pregnancyHelpers";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";

interface PregnancyFormProps {
  initialValues?: PregnancyFormValues;
  onSubmit: (values: PregnancyFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
}

// 妊娠・授乳の登録・編集。片方だけでも保存できる
// (妊娠していないが授乳中、という状態がありうるため)。
export function PregnancyForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
}: PregnancyFormProps) {
  const [values, setValues] = useState<PregnancyFormValues>(initialValues ?? emptyPregnancyForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  const update = makeFieldUpdater(setValues);
  const pregnant = values.status === PREGNANT_CODE;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!values.status && !values.lactation) {
      setValidationError("妊娠状態または授乳状態のどちらかを選択してください。");
      return;
    }
    if (!values.effectiveDate) {
      setValidationError("確認日を入力してください。");
      return;
    }

    setValidationError(null);
    onSubmit(values);
  }

  return (
    <form className="patient-fields" onSubmit={handleSubmit}>
      <fieldset className="patient-fields__group-box">
        <legend>妊娠・授乳</legend>

        <div className="patient-fields__row">
          <label>
            妊娠状態
            <select
              value={values.status}
              onChange={(e) => update("status", e.target.value as PregnancyStatus | "")}
            >
              <option value="">未登録</option>
              {PREGNANCY_STATUS_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            授乳状態
            <select
              value={values.lactation}
              onChange={(e) => update("lactation", e.target.value as LactationStatus | "")}
            >
              <option value="">未登録</option>
              {LACTATION_STATUS_OPTIONS.map((option) => (
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
          {/* 分娩予定日は妊娠中のときだけ意味を持つ。 */}
          {pregnant && (
            <label>
              分娩予定日
              <input
                type="date"
                value={values.dueDate}
                onChange={(e) => update("dueDate", e.target.value)}
              />
            </label>
          )}
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
      </div>
    </form>
  );
}
