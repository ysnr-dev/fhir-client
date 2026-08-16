import {
  appointmentActorDisplay,
  appointmentDateTimeLabel,
  appointmentScheduleLabel,
  appointmentStatusLabel,
  isActiveAppointment,
  isExamAppointment,
} from "../fhir/appointmentHelpers";
import { RowMenu } from "./RowMenu";

interface AppointmentTableProps {
  appointments: fhir4.Appointment[];
  onReschedule: (appointmentId: string) => void;
  onCancel: (appointment: fhir4.Appointment) => void;
  busy: boolean;
}

export function AppointmentTable({
  appointments,
  onReschedule,
  onCancel,
  busy,
}: AppointmentTableProps) {
  if (appointments.length === 0) {
    return <p className="patient-table__empty">予約がありません。</p>;
  }

  return (
    <table className="patient-table">
      <thead>
        <tr>
          <th>日時</th>
          <th>予約枠</th>
          <th>担当医</th>
          <th>診察室</th>
          <th>状態</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {appointments.map((appointment) => {
          // 取り消した予約・受診が済んだ予約は日時を動かせない(枠はもう空きに戻っている)。
          const active = isActiveAppointment(appointment);
          // 検査予約は放射線オーダーとひとかたまり。日時変更はオーダーの撮影日時も
          // 同期するのでここからできるが、取消はオーダー削除の一部としてだけ行う
          // (予約だけ消えてオーダーが残る事故を防ぐ)。
          const exam = isExamAppointment(appointment);

          return (
            <tr key={appointment.id}>
              <td>{appointmentDateTimeLabel(appointment)}</td>
              <td>
                {appointmentScheduleLabel(appointment)}
                {exam && <span className="dose-conversion__badge">検査</span>}
              </td>
              <td>{appointmentActorDisplay(appointment, "Practitioner") || "-"}</td>
              <td>{appointmentActorDisplay(appointment, "Location") || "-"}</td>
              <td>{appointmentStatusLabel(appointment.status)}</td>
              <td className="patient-table__actions">
                {active && (
                  <RowMenu label={`${appointmentDateTimeLabel(appointment)} の予約の操作`}>
                    <button
                      type="button"
                      className="row-menu__item"
                      onClick={() => appointment.id && onReschedule(appointment.id)}
                      disabled={busy}
                    >
                      日時を変更
                    </button>
                    {exam ? (
                      <span className="row-menu__item row-menu__item--muted">
                        取消は放射線オーダーの削除から
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="row-menu__item row-menu__item--danger"
                        onClick={() => onCancel(appointment)}
                        disabled={busy}
                      >
                        取消
                      </button>
                    )}
                  </RowMenu>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
