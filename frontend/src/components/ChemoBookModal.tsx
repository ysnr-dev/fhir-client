import { useState } from "react";
import { useBookChemoAppointment, useRescheduleAppointment } from "../api/queries";
import { appointmentDateTimeLabel, type SlotSelection } from "../fhir/appointmentHelpers";
import { displayName } from "../fhir/patientHelpers";
import { AppointmentSlotPicker } from "./AppointmentSlotPicker";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 外来化学療法室の予約・日時変更(docs/chemo-regimen-design.md §7.6 D-3)。
// カルテ右ペインの投与日パネルから、その日の注射オーダーに対して取る。
//
// リハビリ・栄養指導と同じ形。1 つの適用に投与日が何日もあるので、オーダーと同じ
// transaction には入れず、投与日ごとに都度取る。枠選び UI は診察・検査と同じ
// AppointmentSlotPicker(scheduleType を渡すだけで切り替わる)。

interface Props {
  /** その日の注射オーダー(予約の basedOn)。 */
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 投与日の見出し(「mFOLFOX6 C1 Day1 2026-11-03」)。 */
  label: string;
  /** 日時変更のときだけ渡す。未指定なら新規の予約。 */
  appointment?: fhir4.Appointment;
  onClose: () => void;
}

export function ChemoBookModal({ order, patient, label, appointment, onClose }: Props) {
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  const book = useBookChemoAppointment();
  const reschedule = useRescheduleAppointment();

  const rescheduling = Boolean(appointment);
  const pending = book.isPending || reschedule.isPending;

  function handleSubmit() {
    if (!selection) return;
    if (appointment) {
      reschedule.mutate({ appointment, slots: selection.slots }, { onSuccess: onClose });
      return;
    }
    // 予約は患者を participant に載せるので、患者が読めていないと登録できない。
    if (!patient) return;
    book.mutate({ patient, selection, orderId: order.id ?? "" }, { onSuccess: onClose });
  }

  return (
    <Modal
      title={`${rescheduling ? "化学療法予約の日時変更" : "外来化学療法室の予約"}${
        patient ? ` - ${displayName(patient)}` : ""
      }`}
      onClose={onClose}
      className="modal--wide"
    >
      <div className="appointment-panel">
        <p className="appointment-panel__current">{label}</p>
        {appointment && (
          <p className="appointment-panel__current">変更前: {appointmentDateTimeLabel(appointment)}</p>
        )}

        <ErrorBanner error={book.error} />
        <ErrorBanner error={reschedule.error} />
        {!patient && !rescheduling && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">
              患者情報を読み込めなかったため予約できません。
            </p>
          </div>
        )}

        <AppointmentSlotPicker scheduleType="chemo" selected={selection} onSelect={setSelection} />

        <div className="appointment-panel__actions">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selection || pending || (!patient && !rescheduling)}
          >
            {pending ? "保存中..." : rescheduling ? "この枠に変更" : "この枠で予約"}
          </button>
          <button type="button" onClick={onClose} disabled={pending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
