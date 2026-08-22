import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent } from "react";
import { useOrganizationOptions, useSelfOrganization } from "../api/queries";
import { LOCATION_STATUS_OPTIONS } from "../fhir/locationHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import { emptyWardForm, validateWardForm, type WardFormValues } from "../fhir/wardHelpers";
import { ErrorBanner } from "./ErrorBanner";

interface WardFormProps {
  initialValues?: WardFormValues;
  onSubmit: (values: WardFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel: string;
}

export function WardForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel,
}: WardFormProps) {
  const [values, setValues] = useState<WardFormValues>(initialValues ?? emptyWardForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  // 病棟は自院のものしか登録しない。自院が設定済みなら所属は選ばせず固定する
  // (診察室・診療科と同じ扱い)。
  const self = useSelfOrganization();
  const { organizations } = useOrganizationOptions();

  const update = makeFieldUpdater(setValues);

  const managingOrganizationId = self.selfOrganizationId || values.managingOrganizationId;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateWardForm(values);
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
        病棟名(必須)
        <input
          type="text"
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="東3階病棟"
          required
        />
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
