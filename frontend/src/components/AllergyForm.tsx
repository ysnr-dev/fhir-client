import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { JfagyAllergen } from "../api/masterClient";
import {
  allergenDomainLabel,
  CLINICAL_STATUS_OPTIONS,
  CRITICALITY_OPTIONS,
  emptyAllergyForm,
  TYPE_OPTIONS,
  VERIFICATION_STATUS_OPTIONS,
  type AllergyClinicalStatus,
  type AllergyCriticality,
  type AllergyFormValues,
  type AllergyType,
  type AllergyVerificationStatus,
} from "../fhir/allergyHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { AllergenSearchModal } from "./AllergenSearchModal";

interface AllergyFormProps {
  initialValues?: AllergyFormValues;
  onSubmit: (values: AllergyFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

export function AllergyForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: AllergyFormProps) {
  const [values, setValues] = useState<AllergyFormValues>(initialValues ?? emptyAllergyForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  function update<K extends keyof AllergyFormValues>(key: K, value: AllergyFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleAllergenSelect(allergen: JfagyAllergen) {
    update("allergen", allergen);
    setModalOpen(false);
  }

  function validate(): string | null {
    if (!values.allergen) return "アレルゲンを選択してください。";
    if (!values.recordedDate) return "記録日は必須です。";
    if (values.onsetDate && values.onsetDate > values.recordedDate) {
      return "発症日は記録日以前の日付を入力してください。";
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

  const domainLabel = allergenDomainLabel(values.allergen?.jfagy_code);

  return (
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>アレルゲン</legend>

        <div className="condition-form__row">
          <label>
            アレルゲン
            {values.allergen ? (
              <span className="rp-card__usage-value">{values.allergen.name}</span>
            ) : (
              <span className="rp-card__usage-value rp-card__usage-value--empty">未選択</span>
            )}
          </label>
          <button type="button" onClick={() => setModalOpen(true)}>
            {values.allergen ? "アレルゲンを変更" : "アレルゲンを選択"}
          </button>
        </div>

        {values.allergen && (
          <p className="condition-form__preview">
            登録されるアレルゲン: <strong>{values.allergen.name}</strong>
            {domainLabel && ` (分類: ${domainLabel})`}
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>詳細</legend>
        <label>
          タイプ
          <select value={values.type} onChange={(e) => update("type", e.target.value as AllergyType)}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          重篤化リスク
          <select
            value={values.criticality}
            onChange={(e) => update("criticality", e.target.value as AllergyCriticality)}
          >
            {CRITICALITY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          臨床状態
          <select
            value={values.clinicalStatus}
            onChange={(e) => update("clinicalStatus", e.target.value as AllergyClinicalStatus)}
          >
            {CLINICAL_STATUS_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          確からしさ
          <select
            value={values.verificationStatus}
            onChange={(e) => update("verificationStatus", e.target.value as AllergyVerificationStatus)}
          >
            {VERIFICATION_STATUS_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>経過・メモ</legend>
        <label>
          発症日
          <input
            type="date"
            value={values.onsetDate}
            onChange={(e) => update("onsetDate", e.target.value)}
          />
        </label>
        <label>
          記録日
          <input
            type="date"
            value={values.recordedDate}
            onChange={(e) => update("recordedDate", e.target.value)}
          />
        </label>
        <label className="prescription-form__comment-field">
          症状(蕁麻疹、呼吸困難など)
          <input
            type="text"
            value={values.reaction}
            onChange={(e) => update("reaction", e.target.value)}
          />
        </label>
        <label className="prescription-form__comment-field">
          メモ
          <input type="text" value={values.note} onChange={(e) => update("note", e.target.value)} />
        </label>
      </fieldset>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>

      {modalOpen && (
        <AllergenSearchModal onSelect={handleAllergenSelect} onClose={() => setModalOpen(false)} />
      )}
    </form>
  );
}
