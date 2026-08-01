import { useState, type FormEvent } from "react";
import {
  ORGANIZATION_TYPE_OPTIONS,
  emptyOrganizationForm,
  validateOrganizationForm,
  type OrganizationFormValues,
} from "../fhir/organizationHelpers";
import { ErrorBanner } from "./ErrorBanner";

interface OrganizationFormProps {
  initialValues?: OrganizationFormValues;
  onSubmit: (values: OrganizationFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel: string;
}

export function OrganizationForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel,
}: OrganizationFormProps) {
  const [values, setValues] = useState<OrganizationFormValues>(
    initialValues ?? emptyOrganizationForm,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  function update<K extends keyof OrganizationFormValues>(key: K, value: OrganizationFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateOrganizationForm(values);
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

      <label>
        医療機関名(必須)
        <input
          type="text"
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          required
        />
      </label>

      <label>
        保険医療機関番号
        <input
          type="text"
          inputMode="numeric"
          value={values.institutionNumber}
          onChange={(e) => update("institutionNumber", e.target.value)}
          placeholder="1310000001"
        />
      </label>
      <p className="organization-form__hint">
        10桁の数字(都道府県2桁 + 点数表1桁 + 医療機関コード7桁)。未入力でも登録できます。
      </p>

      <label>
        種別
        <select value={values.typeCode} onChange={(e) => update("typeCode", e.target.value)}>
          <option value="">未指定</option>
          {ORGANIZATION_TYPE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
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
        FAX
        <input type="text" value={values.fax} onChange={(e) => update("fax", e.target.value)} />
      </label>

      <label>
        郵便番号
        <input
          type="text"
          value={values.postalCode}
          onChange={(e) => update("postalCode", e.target.value)}
          placeholder="100-0001"
        />
      </label>

      <label>
        所在地
        <input
          type="text"
          value={values.addressText}
          onChange={(e) => update("addressText", e.target.value)}
        />
      </label>

      <div className="patient-form__actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
