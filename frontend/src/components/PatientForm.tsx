import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent } from "react";
import { emptyPatientForm, type PatientFormValues } from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";

interface PatientFormProps {
  initialValues?: PatientFormValues;
  onSubmit: (values: PatientFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel: string;
}

export function PatientForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel,
}: PatientFormProps) {
  const [values, setValues] = useState<PatientFormValues>(initialValues ?? emptyPatientForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  const update = makeFieldUpdater(setValues);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values.identifierValue.trim()) {
      setValidationError("患者番号は必須です。");
      return;
    }
    setValidationError(null);
    onSubmit(values);
  }

  return (
    <form className="patient-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>患者番号(必須)</legend>
        <label>
          番号
          <input
            type="text"
            value={values.identifierValue}
            onChange={(e) => update("identifierValue", e.target.value)}
            required
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>氏名(漢字)</legend>
        <label>
          {"姓"}
          <input type="text" value={values.familyKanji} onChange={(e) => update("familyKanji", e.target.value)} />
        </label>
        <label>
          {"名"}
          <input type="text" value={values.givenKanji} onChange={(e) => update("givenKanji", e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>氏名(カナ)</legend>
        <label>
          セイ
          <input type="text" value={values.familyKana} onChange={(e) => update("familyKana", e.target.value)} />
        </label>
        <label>
          メイ
          <input type="text" value={values.givenKana} onChange={(e) => update("givenKana", e.target.value)} />
        </label>
      </fieldset>

      <label>
        性別
        <select value={values.gender} onChange={(e) => update("gender", e.target.value as PatientFormValues["gender"])}>
          <option value="">未指定</option>
          <option value="male">男性</option>
          <option value="female">女性</option>
          <option value="other">その他</option>
          <option value="unknown">不明</option>
        </select>
      </label>

      <label>
        生年月日
        <input type="date" value={values.birthDate} onChange={(e) => update("birthDate", e.target.value)} />
      </label>

      <label className="patient-form__checkbox">
        <input type="checkbox" checked={values.active} onChange={(e) => update("active", e.target.checked)} />
        有効(active)
      </label>

      <label>
        電話番号
        <input type="text" value={values.phone} onChange={(e) => update("phone", e.target.value)} />
      </label>

      <label>
        住所
        <input type="text" value={values.addressText} onChange={(e) => update("addressText", e.target.value)} />
      </label>

      <div className="patient-form__actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
