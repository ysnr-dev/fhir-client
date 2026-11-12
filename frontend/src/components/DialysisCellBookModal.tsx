import { useState } from "react";
import { FhirError } from "../api/fhirClient";
import { useBookDialysisAppointments, type DialysisWorklistRow } from "../api/queries";
import { dialysisAppointmentDate, dialysisAppointmentShift } from "../fhir/dialysisAppointmentHelpers";
import { summarizeDialysisOrder } from "../fhir/dialysisOrderHelpers";
import { dialysisTaskStatus } from "../fhir/dialysisTaskHelpers";
import { dialysisBoardBedLabel } from "../fhir/dialysisUnitHelpers";
import { displayName } from "../fhir/patientHelpers";
import { formatDateLabel } from "../fhir/scheduleHelpers";
import type { DialysisBoardCellTarget } from "./DialysisBoard";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// ボードの空いている枠から直接取る予約(docs/dialysis-order-design.md §5.3 の 5)。
// 枠(ベッド × 日 × シフト)は決まっているので、誰の予約かだけを選ぶ。候補は一覧に効いている受付済の
// 透析室のオーダーのうち、その日が期間内で、その日 × シフトにまだ予約が無いもの。

interface Props {
  target: DialysisBoardCellTarget;
  /** 透析一覧の行(基準日に効いているオーダー)。 */
  rows: readonly DialysisWorklistRow[];
  /** その日 × シフトに既に予約があるオーダー(候補から外す)。 */
  booked: readonly fhir4.Appointment[];
  onClose: () => void;
}

export function DialysisCellBookModal({ target, rows, booked, onClose }: Props) {
  const book = useBookDialysisAppointments();
  const [orderId, setOrderId] = useState("");
  const [conflict, setConflict] = useState(false);

  const bookedOrderIds = new Set(
    booked
      .filter(
        (appointment) =>
          dialysisAppointmentDate(appointment) === target.date &&
          dialysisAppointmentShift(appointment, [target.shift])?.code === target.shift.code,
      )
      .map((appointment) => appointment.basedOn?.[0]?.reference?.split("/").pop() ?? ""),
  );
  const candidates = rows
    .filter((row) => {
      if (!row.patient || !row.order.id || bookedOrderIds.has(row.order.id)) return false;
      if (dialysisTaskStatus(row.task) !== "accepted") return false;
      const summary = summarizeDialysisOrder(row.order);
      if (summary.bedside || summary.startDate > target.date) return false;
      return !summary.endDate || summary.endDate >= target.date;
    })
    .sort((a, b) => (a.patient?.identifier?.[0]?.value ?? "").localeCompare(b.patient?.identifier?.[0]?.value ?? ""));
  const selected = candidates.find((row) => row.order.id === orderId);

  function handleSubmit() {
    if (!selected?.patient || !selected.order.id || !target.bed.schedule) return;
    setConflict(false);
    book.mutate(
      {
        patient: selected.patient,
        orderId: selected.order.id,
        bookings: [
          {
            schedule: target.bed.schedule,
            slot: target.slot,
            shift: { code: target.shift.code, label: target.shift.label },
          },
        ],
      },
      {
        onSuccess: onClose,
        onError: (error: Error) => {
          if (error instanceof FhirError && error.status === 412) setConflict(true);
        },
      },
    );
  }

  return (
    <Modal title="透析の予約" onClose={onClose}>
      <div className="appointment-panel">
        <p className="appointment-panel__current">
          {formatDateLabel(target.date)} {target.shift.label} {target.shift.start}〜{target.shift.end} / ベッド{" "}
          {dialysisBoardBedLabel(target.bed, true)}
        </p>
        {conflict ? (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">
              別の患者が先にこの枠を取りました。ボードを読み直したので、確かめてください。
            </p>
          </div>
        ) : (
          <ErrorBanner error={book.error} />
        )}
        <div className="walk-in__fields">
          <label>
            患者
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">選択してください</option>
              {candidates.map((row) => {
                const summary = summarizeDialysisOrder(row.order);
                return (
                  <option key={row.order.id} value={row.order.id}>
                    {[
                      row.patient?.identifier?.[0]?.value ?? "",
                      row.patient ? displayName(row.patient) : "",
                      `${summary.modalityShort} ${summary.scheduleLabel}`.trim(),
                    ]
                      .filter(Boolean)
                      .join(" / ")}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        {candidates.length === 0 && (
          <p className="order-select__muted">この日に予約を取れる透析オーダーがありません</p>
        )}
        <div className="appointment-panel__actions">
          <button type="button" onClick={handleSubmit} disabled={!selected || book.isPending}>
            {book.isPending ? "保存中..." : "予約"}
          </button>
          <button type="button" onClick={onClose} disabled={book.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
