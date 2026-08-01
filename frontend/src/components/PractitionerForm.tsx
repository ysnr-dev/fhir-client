import { useState, type FormEvent } from "react";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import {
  emptyPractitionerForm,
  validatePractitionerForm,
  type PractitionerFormValues,
} from "../fhir/practitionerHelpers";
import { PRACTITIONER_ROLE_OPTIONS } from "../fhir/practitionerRoleHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { OrganizationSearchModal } from "./OrganizationSearchModal";

interface PractitionerFormProps {
  initialValues?: PractitionerFormValues;
  onSubmit: (values: PractitionerFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel: string;
}

export function PractitionerForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel,
}: PractitionerFormProps) {
  const [values, setValues] = useState<PractitionerFormValues>(
    initialValues ?? emptyPractitionerForm,
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [organizationModalOpen, setOrganizationModalOpen] = useState(false);

  function update<K extends keyof PractitionerFormValues>(key: K, value: PractitionerFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleOrganizationSelect(organization: fhir4.Organization) {
    setValues((v) => ({
      ...v,
      organizationId: organization.id ?? "",
      organizationName: organizationDisplayName(organization),
    }));
    setOrganizationModalOpen(false);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validatePractitionerForm(values);
    if (error) {
      setValidationError(error);
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
        <legend>氏名(漢字・必須)</legend>
        <label>
          {"姓"}
          <input
            type="text"
            value={values.familyKanji}
            onChange={(e) => update("familyKanji", e.target.value)}
          />
        </label>
        <label>
          {"名"}
          <input
            type="text"
            value={values.givenKanji}
            onChange={(e) => update("givenKanji", e.target.value)}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>氏名(カナ)</legend>
        <label>
          セイ
          <input
            type="text"
            value={values.familyKana}
            onChange={(e) => update("familyKana", e.target.value)}
          />
        </label>
        <label>
          メイ
          <input
            type="text"
            value={values.givenKana}
            onChange={(e) => update("givenKana", e.target.value)}
          />
        </label>
      </fieldset>

      <label>
        医籍登録番号
        <input
          type="text"
          value={values.medicalRegistrationNumber}
          onChange={(e) => update("medicalRegistrationNumber", e.target.value)}
        />
      </label>

      <label>
        性別
        <select
          value={values.gender}
          onChange={(e) => update("gender", e.target.value as PractitionerFormValues["gender"])}
        >
          <option value="">未指定</option>
          <option value="male">男性</option>
          <option value="female">女性</option>
          <option value="other">その他</option>
          <option value="unknown">不明</option>
        </select>
      </label>

      <label>
        生年月日
        <input
          type="date"
          value={values.birthDate}
          onChange={(e) => update("birthDate", e.target.value)}
        />
      </label>

      <label className="patient-form__checkbox">
        <input
          type="checkbox"
          checked={values.active}
          onChange={(e) => update("active", e.target.checked)}
        />
        有効(active)
      </label>

      <label>
        電話番号
        <input type="text" value={values.phone} onChange={(e) => update("phone", e.target.value)} />
      </label>

      <label>
        メールアドレス
        <input type="email" value={values.email} onChange={(e) => update("email", e.target.value)} />
      </label>

      <fieldset className="practitioner-form__role">
        <legend>職種・所属</legend>
        <label>
          職種
          <select value={values.roleCode} onChange={(e) => update("roleCode", e.target.value)}>
            <option value="">未指定</option>
            {PRACTITIONER_ROLE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="practitioner-form__organization">
          <span className="qp-field__label">所属医療機関</span>
          <span className="practitioner-form__organization-value">
            {values.organizationName || (
              <span className="rp-card__usage-value--empty">未選択</span>
            )}
          </span>
          <button type="button" onClick={() => setOrganizationModalOpen(true)}>
            {values.organizationId ? "変更" : "選択"}
          </button>
          {values.organizationId && (
            <button
              type="button"
              onClick={() =>
                setValues((v) => ({ ...v, organizationId: "", organizationName: "" }))
              }
            >
              クリア
            </button>
          )}
        </div>
      </fieldset>

      <div className="patient-form__actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>

      {organizationModalOpen && (
        <OrganizationSearchModal
          onSelect={handleOrganizationSelect}
          onClose={() => setOrganizationModalOpen(false)}
        />
      )}
    </form>
  );
}
