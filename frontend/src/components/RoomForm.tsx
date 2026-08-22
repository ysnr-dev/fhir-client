import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent } from "react";
import { useOrganizationOptions, useSelfOrganization } from "../api/queries";
import { LOCATION_STATUS_OPTIONS } from "../fhir/locationHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import {
  MAX_BED_COUNT,
  ROOM_CLASS_OPTIONS,
  emptyRoomForm,
  validateRoomForm,
  type RoomFormValues,
} from "../fhir/wardHelpers";
import { ErrorBanner } from "./ErrorBanner";

interface RoomFormProps {
  initialValues?: RoomFormValues;
  onSubmit: (values: RoomFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel: string;
  /** 編集時のみ true。ベッドの増減について注意書きを出す。 */
  editing?: boolean;
}

export function RoomForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel,
  editing = false,
}: RoomFormProps) {
  const [values, setValues] = useState<RoomFormValues>(initialValues ?? emptyRoomForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const self = useSelfOrganization();
  const { organizations } = useOrganizationOptions();

  const update = makeFieldUpdater(setValues);

  const managingOrganizationId = self.selfOrganizationId || values.managingOrganizationId;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateRoomForm(values);
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
        病室名(必須)
        <input
          type="text"
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="301号室"
          required
        />
      </label>

      <label>
        区分
        <select value={values.roomClass} onChange={(e) => update("roomClass", e.target.value)}>
          {ROOM_CLASS_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        ベッド数(必須)
        <input
          type="number"
          min={1}
          max={MAX_BED_COUNT}
          value={values.bedCount}
          onChange={(e) => update("bedCount", e.target.value)}
          required
        />
      </label>
      {editing && (
        <p className="organization-form__hint">
          ベッドは番号順(1、2、…)に作られます。数を減らすと番号の大きいベッドから削除されます。
        </p>
      )}

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
