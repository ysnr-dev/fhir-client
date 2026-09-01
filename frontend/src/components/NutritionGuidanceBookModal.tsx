import { useState } from "react";
import { useBookNutritionGuidanceAppointment, useRescheduleAppointment } from "../api/queries";
import { appointmentDateTimeLabel, type SlotSelection } from "../fhir/appointmentHelpers";
import { displayName } from "../fhir/patientHelpers";
import { summarizeNutritionGuidanceOrder } from "../fhir/nutritionGuidanceOrderHelpers";
import { AppointmentSlotPicker } from "./AppointmentSlotPicker";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 栄養指導の次回予約・日時変更。栄養指導一覧の行から開く。
//
// リハビリと同じく、1 つのオーダーに予約が何件もぶら下がるのでオーダー登録の
// transaction には同梱せず、栄養部門が受付後にここから都度取る
// (docs/nutrition-guidance-order-design.md §6)。
//
// 枠は「栄養指導予約」種別の枠表(栄養相談室 Location)から選ぶ。枠選び UI は診察・検査と
// 同じ AppointmentSlotPicker をそのまま使う(scheduleType を渡すだけで切り替わる)。
// 所要時間(requiredMinutes)は渡さない。1 予約 = 1 枠。

interface Props {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 日時変更のときだけ渡す。未指定なら新規の次回予約。 */
  appointment?: fhir4.Appointment;
  onClose: () => void;
}

export function NutritionGuidanceBookModal({ order, patient, appointment, onClose }: Props) {
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  const book = useBookNutritionGuidanceAppointment();
  const reschedule = useRescheduleAppointment();

  const summary = summarizeNutritionGuidanceOrder(order);
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
      title={`${rescheduling ? "栄養指導予約の日時変更" : "栄養指導の次回予約"}${
        patient ? ` - ${displayName(patient)}` : ""
      }`}
      onClose={onClose}
      className="modal--wide"
    >
      <div className="appointment-panel">
        <p className="appointment-panel__current">
          {[summary.formatShort, summary.targetDisease, summary.targetDiet]
            .filter(Boolean)
            .join(" / ")}
        </p>
        {appointment && (
          <p className="appointment-panel__current">
            変更前: {appointmentDateTimeLabel(appointment)}
          </p>
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

        <AppointmentSlotPicker
          scheduleType="nutrition-guidance"
          selected={selection}
          onSelect={setSelection}
        />

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
