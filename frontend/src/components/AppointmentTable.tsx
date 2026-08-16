import {
  appointmentActorDisplay,
  appointmentDateTimeLabel,
  appointmentScheduleLabel,
  appointmentStatusLabel,
  isActiveAppointment,
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

          return (
            <tr key={appointment.id}>
              <td>{appointmentDateTimeLabel(appointment)}</td>
              <td>{appointmentScheduleLabel(appointment)}</td>
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
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => onCancel(appointment)}
                      disabled={busy}
                    >
                      取消
                    </button>
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
