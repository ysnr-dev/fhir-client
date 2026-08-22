import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent } from "react";
import { useOrganizationOptions, useSelfOrganization } from "../api/queries";
import {
  LOCATION_STATUS_OPTIONS,
  LOCATION_TYPE_OPTIONS,
  emptyLocationForm,
  validateLocationForm,
  type LocationFormValues,
} from "../fhir/locationHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import { ErrorBanner } from "./ErrorBanner";

interface LocationFormProps {
  initialValues?: LocationFormValues;
  onSubmit: (values: LocationFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel: string;
}

export function LocationForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel,
}: LocationFormProps) {
  const [values, setValues] = useState<LocationFormValues>(initialValues ?? emptyLocationForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  // 診察室・撮影室は自院の部屋しか登録しないので、自院が設定済みなら所属は
  // 選ばせず固定する。自院未設定の環境だけ従来どおり選択できる。
  const self = useSelfOrganization();
  const { organizations } = useOrganizationOptions();

  const update = makeFieldUpdater(setValues);

  const managingOrganizationId = self.selfOrganizationId || values.managingOrganizationId;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateLocationForm(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    onSubmit({ ...values, managingOrganizationId });
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
        名称(必須)
        <input
          type="text"
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="第1診察室"
          required
        />
      </label>

      <label>
        種別
        <select value={values.typeCode} onChange={(e) => update("typeCode", e.target.value)}>
          <option value="">未指定</option>
          {LOCATION_TYPE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        状態
        <select value={values.status} onChange={(e) => update("status", e.target.value)}>
          {LOCATION_STATUS_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {!self.selfOrganizationId && (
        <label>
          所属医療機関
          <select
            value={values.managingOrganizationId}
            onChange={(e) => update("managingOrganizationId", e.target.value)}
          >
            <option value="">未指定</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organizationDisplayName(organization)}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        備考
        <input
          type="text"
          value={values.description}
          onChange={(e) => update("description", e.target.value)}
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
