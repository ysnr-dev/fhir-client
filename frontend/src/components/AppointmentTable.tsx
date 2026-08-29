import {
  appointmentActorDisplay,
  appointmentDateTimeLabel,
  appointmentScheduleLabel,
  appointmentStatusLabel,
  isActiveAppointment,
  isExamAppointment,
  isRehabAppointment,
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
          // リハビリ予約もオーダーにぶら下がる(basedOn を持つ)ので isExamAppointment は
          // true になる。**リハビリの判定を先に行うこと。**
          //
          // リハビリはオーダーの日時と予約が連動しない(期間オーダーに予約が何件も
          // ぶら下がり、部門が都度取り直す)ので、ここから日時変更・取消をしてよい。
          const rehab = isRehabAppointment(appointment);
          // 検査予約は放射線オーダーとひとかたまりなので、ここからは動かさない。
          // 日時変更はオーダーの編集(撮影日時と一緒に動かす)、取消はオーダーの削除
          // (予約だけ消えてオーダーが残る事故を防ぐ)でだけ行う。
          const exam = !rehab && isExamAppointment(appointment);

          return (
            <tr key={appointment.id}>
              <td>{appointmentDateTimeLabel(appointment)}</td>
              <td>
                {appointmentScheduleLabel(appointment)}
                {exam && <span className="dose-conversion__badge">検査</span>}
                {rehab && <span className="dose-conversion__badge">リハビリ</span>}
              </td>
              <td>{appointmentActorDisplay(appointment, "Practitioner") || "-"}</td>
              <td>{appointmentActorDisplay(appointment, "Location") || "-"}</td>
              <td>{appointmentStatusLabel(appointment.status)}</td>
              <td className="patient-table__actions">
                {active && (
                  <RowMenu label={`${appointmentDateTimeLabel(appointment)} の予約の操作`}>
                    {exam ? (
                      // 検査予約(オーダーにぶら下がる予約)の日時はオーダーの実施日時と
                      // 一緒に動かすので、変更の入口はオーダーの編集画面に一本化している。
                      // 種別は放射線・生理検査の双方があるので「検査オーダー」と呼ぶ。
                      <span className="row-menu__item row-menu__item--muted">
                        日時変更・取消は検査オーダーから
                      </span>
                    ) : (
                      <>
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
                      </>
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
