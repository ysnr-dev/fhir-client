import { useState } from "react";
import {
  useAppointment,
  useBookAppointment,
  usePatient,
  useRescheduleAppointment,
} from "../api/queries";
import {
  appointmentActorId,
  appointmentDateTimeLabel,
  appointmentDepartmentCode,
  buildAppointment,
  emptyAppointmentForm,
  type AppointmentFormValues,
} from "../fhir/appointmentHelpers";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { AppointmentSlotPicker, type SlotSelection } from "./AppointmentSlotPicker";
import { ErrorBanner } from "./ErrorBanner";

// 予約の登録と日時変更。カルテ画面の右ペインから使う。
//
// 枠を選ぶところは共通(AppointmentSlotPicker)。登録は選んだ枠に予約種別とメモを
// 添えて確定させ、日時変更は選び直した枠に付け替える。予約と枠の状態はどちらも
// 1 つの transaction で書く。

interface AppointmentCreatePanelProps {
  patientId: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function AppointmentCreatePanel({
  patientId,
  defaultProblem,
  onSaved,
}: AppointmentCreatePanelProps) {
  const { data: patientResult, error: patientError } = usePatient(patientId);
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  const [values, setValues] = useState<AppointmentFormValues>(emptyAppointmentForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const book = useBookAppointment();

  function handleSubmit() {
    const patient = patientResult?.data;
    if (!patient) return;
    if (!selection) {
      setValidationError("予約する枠を選んでください。");
      return;
    }
    setValidationError(null);

    const appointment = buildAppointment(
      values,
      patient,
      selection.schedule,
      selection.slots,
      defaultProblem,
    );
    book.mutate({ appointment, slots: selection.slots }, { onSuccess: onSaved });
  }

  return (
    <div className="appointment-panel">
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={patientError} />
      <ErrorBanner error={book.error} />

      <AppointmentSlotPicker scheduleType="consultation" selected={selection} onSelect={setSelection} />

      <div className="appointment-panel__form">
        <label>
          メモ
          <textarea
            rows={3}
            value={values.comment}
            onChange={(e) => setValues({ ...values, comment: e.target.value })}
          />
        </label>
        {defaultProblem && (
          <p className="appointment-panel__problem">対象プロブレム: {defaultProblem.display}</p>
        )}
      </div>

      <div className="appointment-panel__actions">
        <button type="button" onClick={handleSubmit} disabled={book.isPending || !selection}>
          {book.isPending ? "登録中..." : "登録"}
        </button>
      </div>
    </div>
  );
}

interface AppointmentReschedulePanelProps {
  appointmentId: string;
  onSaved: () => void;
}

export function AppointmentReschedulePanel({
  appointmentId,
  onSaved,
}: AppointmentReschedulePanelProps) {
  const { data: result, isLoading, error } = useAppointment(appointmentId);
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  const reschedule = useRescheduleAppointment();

  const appointment = result?.data;

  function handleSubmit() {
    if (!appointment || !selection) return;
    reschedule.mutate({ appointment, slots: selection.slots }, { onSuccess: onSaved });
  }

  if (isLoading) return <p>読み込み中...</p>;

  if (error || !appointment) {
    return <ErrorBanner error={error ?? new Error("予約を読み込めませんでした。")} />;
  }

  return (
    <div className="appointment-panel">
      <p className="appointment-panel__current">変更前: {appointmentDateTimeLabel(appointment)}</p>

      <ErrorBanner error={reschedule.error} />

      {/* 元の予約と同じ診療科・担当医から探し始める。ここに来るのは診察予約だけ
          (検査予約の日時は放射線オーダーの編集から、撮影日時と一緒に変える)。 */}
      <AppointmentSlotPicker
        scheduleType="consultation"
        defaultDepartmentCode={appointmentDepartmentCode(appointment)}
        defaultPractitionerId={appointmentActorId(appointment, "Practitioner")}
        selected={selection}
        onSelect={setSelection}
      />

      <div className="appointment-panel__actions">
        <button type="button" onClick={handleSubmit} disabled={!selection || reschedule.isPending}>
          {reschedule.isPending ? "変更中..." : "この枠に変更"}
        </button>
      </div>
    </div>
  );
}
