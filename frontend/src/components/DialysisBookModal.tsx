import { useMemo, useState } from "react";
import { FhirError } from "../api/fhirClient";
import {
  useBookDialysisAppointments,
  useDialysisShifts,
  useDialysisSlots,
  useDialysisUnits,
  useRescheduleDialysisAppointment,
} from "../api/queries";
import { appointmentDateTimeLabel } from "../fhir/appointmentHelpers";
import {
  dialysisAppointmentBedId,
  dialysisAppointmentDate,
  dialysisAppointmentShift,
  findDialysisSlot,
} from "../fhir/dialysisAppointmentHelpers";
import { summarizeDialysisOrder } from "../fhir/dialysisOrderHelpers";
import { activeDialysisBeds, dialysisBoardBedLabel } from "../fhir/dialysisUnitHelpers";
import { displayName } from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 臨時の 1 件(スポット)の予約と、予約の変更(docs/dialysis-order-design.md §5.3 の 4)。
// 日付とシフトを決めて、その日 × シフトの空いているベッドを選ぶ。変更では元の日・シフト・ベッドを初期値にする。

interface Props {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 変更のときだけ渡す。 */
  appointment?: fhir4.Appointment;
  defaultDate: string;
  onClose: () => void;
}

export function DialysisBookModal({ order, patient, appointment, defaultDate, onClose }: Props) {
  const shifts = useDialysisShifts();
  const units = useDialysisUnits();
  const book = useBookDialysisAppointments();
  const reschedule = useRescheduleDialysisAppointment();
  const summary = summarizeDialysisOrder(order);

  const [date, setDate] = useState(appointment ? dialysisAppointmentDate(appointment) : defaultDate);
  const [shiftCode, setShiftCode] = useState(
    (appointment && dialysisAppointmentShift(appointment, shifts)?.code) || shifts[0]?.code || "",
  );
  const [bedId, setBedId] = useState(appointment ? dialysisAppointmentBedId(appointment) : "");
  const [conflict, setConflict] = useState(false);

  const beds = useMemo(
    () => activeDialysisBeds(units.data?.groups ?? [], units.data?.schedulesByBedId ?? new Map()),
    [units.data],
  );
  const multiUnit = new Set(beds.map((entry) => entry.unit.id)).size > 1;
  const scheduleIds = beds.flatMap((entry) => (entry.schedule?.id ? [entry.schedule.id] : []));
  const slots = useDialysisSlots(scheduleIds, date, date);
  const shift = shifts.find((s) => s.code === shiftCode);

  const candidates = beds.map((entry) => {
    const slot = shift
      ? findDialysisSlot(
          (slots.data ?? []).filter((s) => s.schedule.reference === `Schedule/${entry.schedule?.id}`),
          date,
          shift,
        )
      : undefined;
    // 変更前の枠は自分が押さえているので選べる(同じ枠への変更は何も起きない)。
    const own = Boolean(slot?.id && appointment?.slot?.some((ref) => ref.reference === `Slot/${slot.id}`));
    return { entry, slot, selectable: Boolean(slot && (slot.status === "free" || own)), own };
  });
  const selected = candidates.find((candidate) => candidate.entry.bed.id === bedId && candidate.selectable);
  const pending = book.isPending || reschedule.isPending;

  function handleSubmit() {
    if (!selected?.slot || !selected.entry.schedule || !shift || !order.id) return;
    if (selected.own) {
      onClose();
      return;
    }
    const booking = {
      schedule: selected.entry.schedule,
      slot: selected.slot,
      shift: { code: shift.code, label: shift.label },
    };
    setConflict(false);
    const handlers = {
      onSuccess: onClose,
      onError: (error: Error) => {
        if (error instanceof FhirError && error.status === 412) setConflict(true);
      },
    };
    if (appointment) {
      reschedule.mutate({ appointment, booking }, handlers);
      return;
    }
    if (!patient) return;
    book.mutate({ patient, orderId: order.id, bookings: [booking] }, handlers);
  }

  return (
    <Modal
      title={`${appointment ? "透析予約の変更" : "透析の臨時予約"}${patient ? ` - ${displayName(patient)}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <div className="appointment-panel">
        <p className="appointment-panel__current">
          {[summary.modalityShort, summary.scheduleLabel, summary.periodLabel].filter(Boolean).join(" / ")}
        </p>
        {appointment && (
          <p className="appointment-panel__current">
            変更前: {appointmentDateTimeLabel(appointment)} {appointment.description ?? ""}
          </p>
        )}

        <ErrorBanner error={units.error} />
        <ErrorBanner error={slots.error} />
        {conflict ? (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">
              別の患者が先にこの枠を取りました。空きを読み直したので、選び直してください。
            </p>
          </div>
        ) : (
          <>
            <ErrorBanner error={book.error} />
            <ErrorBanner error={reschedule.error} />
          </>
        )}

        <div className="walk-in__fields">
          <label>
            日付
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <label>
            シフト
            <select value={shiftCode} onChange={(e) => setShiftCode(e.target.value)}>
              {shifts.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label} {option.start}〜{option.end}
                </option>
              ))}
            </select>
          </label>
        </div>

        {slots.isLoading || units.isLoading ? (
          <p>読み込み中...</p>
        ) : (
          <div className="dialysis-book__beds" role="radiogroup" aria-label="ベッド">
            {candidates.map(({ entry, slot, selectable, own }) => (
              <label
                key={entry.bed.id}
                className={`dialysis-book__bed${selectable ? "" : " dialysis-book__bed--disabled"}`}
              >
                <input
                  type="radio"
                  name="dialysis-bed"
                  value={entry.bed.id}
                  checked={bedId === entry.bed.id}
                  disabled={!selectable}
                  onChange={() => setBedId(entry.bed.id ?? "")}
                />
                {dialysisBoardBedLabel(entry, multiUnit)}
                <span className="dialysis-book__bed-state">
                  {own ? "現在" : !slot ? "枠なし" : slot.status === "free" ? "空き" : "埋まり"}
                </span>
              </label>
            ))}
            {candidates.length === 0 && <p className="patient-table__empty">有効なベッドがありません</p>}
          </div>
        )}

        <div className="appointment-panel__actions">
          <button type="button" onClick={handleSubmit} disabled={!selected || pending || (!appointment && !patient)}>
            {pending ? "保存中..." : appointment ? "変更" : "予約"}
          </button>
          <button type="button" onClick={onClose} disabled={pending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
