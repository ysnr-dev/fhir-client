import { useState, type FormEvent } from "react";
import { useDepartmentList, useLocationOptions, usePractitionerOptions } from "../api/queries";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  emptyScheduleForm,
  validateScheduleForm,
  type ScheduleFormValues,
} from "../fhir/scheduleHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { SlotPatternFields } from "./SlotPatternFields";

export interface ScheduleActorNames {
  practitioner?: string;
  location?: string;
}

interface ScheduleFormProps {
  initialValues?: ScheduleFormValues;
  onSubmit: (values: ScheduleFormValues, actorNames: ScheduleActorNames) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel: string;
}

export function ScheduleForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel,
}: ScheduleFormProps) {
  const [values, setValues] = useState<ScheduleFormValues>(initialValues ?? emptyScheduleForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { practitioners } = usePractitionerOptions();
  const { locations } = useLocationOptions();
  const { departments } = useDepartmentList({});

  function update<K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // 診療科は Organization を選ばせて、SS-MIX2 コードと名称を Schedule.specialty に写す。
  function handleDepartmentChange(id: string) {
    const department = departments.find((d) => d.id === id);
    setValues((v) => ({
      ...v,
      departmentCode: department ? departmentCode(department) : "",
      departmentName: department ? departmentDisplayName(department) : "",
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateScheduleForm(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    // actor.display に名前を持たせておくと、一覧やカレンダーの見出しを
    // Practitioner / Location を引き直さずに描ける。
    const practitioner = practitioners.find((p) => p.id === values.practitionerId);
    const location = locations.find((l) => l.id === values.locationId);
    onSubmit(values, {
      practitioner: practitioner ? practitionerDisplayName(practitioner) : undefined,
      location: location ? locationDisplayName(location) : undefined,
    });
  }

  // 診療科の選択状態は、保存済みのコードから引き当てる(Organization.id は
  // Schedule に持たないため)。
  const selectedDepartmentId =
    departments.find((d) => departmentCode(d) === values.departmentCode)?.id ?? "";

  return (
    <form className="patient-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <label>
        枠の名称(必須)
        <input
          type="text"
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="午前一般外来"
          required
        />
      </label>

      <label>
        担当医
        <select
          value={values.practitionerId}
          onChange={(e) => update("practitionerId", e.target.value)}
        >
          <option value="">未指定</option>
          {practitioners.map((practitioner) => (
            <option key={practitioner.id} value={practitioner.id}>
              {practitionerDisplayName(practitioner)}
            </option>
          ))}
        </select>
      </label>

      <label>
        診察室・撮影室
        <select value={values.locationId} onChange={(e) => update("locationId", e.target.value)}>
          <option value="">未指定</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {locationDisplayName(location)}
            </option>
          ))}
        </select>
      </label>

      <label>
        診療科
        <select value={selectedDepartmentId} onChange={(e) => handleDepartmentChange(e.target.value)}>
          <option value="">未指定</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {departmentDisplayName(department)}
            </option>
          ))}
        </select>
      </label>

      {/* 未入力なら無期限の枠表になる。 */}
      <div className="schedule-form__period">
        <label>
          有効期間(開始)
          <input
            type="date"
            value={values.horizonStart}
            onChange={(e) => update("horizonStart", e.target.value)}
          />
        </label>
        <label>
          有効期間(終了)
          <input
            type="date"
            value={values.horizonEnd}
            onChange={(e) => update("horizonEnd", e.target.value)}
          />
        </label>
      </div>

      <label className="patient-form__checkbox">
        <input
          type="checkbox"
          checked={values.active}
          onChange={(e) => update("active", e.target.checked)}
        />
        有効(active)
      </label>

      {/* ここで決めた条件は枠表に保存され、カレンダーの「枠を一括生成」の初期値になる。 */}
      <fieldset className="schedule-form__pattern">
        <legend>枠のパターン</legend>
        <SlotPatternFields value={values.pattern} onChange={(pattern) => update("pattern", pattern)} />
      </fieldset>

      <label>
        メモ
        <input
          type="text"
          value={values.comment}
          onChange={(e) => update("comment", e.target.value)}
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
