import { useState, type FormEvent } from "react";
import {
  BLOOD_TYPE_SOURCE_OPTIONS,
  emptyBloodTypeForm,
  type BloodTypeFormValues,
  type BloodTypeSource,
} from "../fhir/bloodTypeHelpers";
import {
  ABO_OPTIONS,
  RHD_OPTIONS,
  type AboBloodType,
  type RhdBloodType,
} from "../fhir/transfusionOrderHelpers";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";

interface BloodTypeFormProps {
  initialValues?: BloodTypeFormValues;
  onSubmit: (values: BloodTypeFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
}

// 血液型の登録・編集。ABO と RhD は片方だけでも保存できる
// (「ABO は分かっているが RhD はこれから」がありうるため)。
export function BloodTypeForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
}: BloodTypeFormProps) {
  const [values, setValues] = useState<BloodTypeFormValues>(initialValues ?? emptyBloodTypeForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  const update = makeFieldUpdater(setValues);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!values.abo && !values.rhd) {
      setValidationError("ABO または RhD のどちらかを選択してください。");
      return;
    }

    setValidationError(null);
    onSubmit(values);
  }

  return (
    <form className="patient-fields" onSubmit={handleSubmit}>
      <div className="patient-fields__row">
        <label className="patient-fields__field--gender">
          ABO
          <select
            value={values.abo}
            onChange={(e) => update("abo", e.target.value as AboBloodType | "")}
          >
            <option value="">未確定</option>
            {ABO_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label className="patient-fields__field--gender">
          RhD
          <select
            value={values.rhd}
            onChange={(e) => update("rhd", e.target.value as RhdBloodType | "")}
          >
            <option value="">未確定</option>
            {RHD_OPTIONS.map((option) => (
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
            onChange={(e) => update("source", e.target.value as BloodTypeSource)}
          >
            {BLOOD_TYPE_SOURCE_OPTIONS.map((option) => (
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
