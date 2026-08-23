import { useAppointmentSearch, useCancelAppointment } from "../api/queries";
import {
  appointmentDateTimeLabel,
} from "../fhir/appointmentHelpers";
import { AppointmentTable } from "./AppointmentTable";
import { ErrorBanner } from "./ErrorBanner";

// カルテ画面の「予約」タブ。その患者の予約を一覧し、取消を行う。
//
// 登録と日時変更はどちらも枠を選ぶ操作で、右ペイン(AppointmentPanels)の担当。
// 左ペインは一覧に徹する。予約はカルテのカードにしない方針なので、
// タイムラインとは連動しない。

interface KarteAppointmentTabProps {
  patientId: string;
  /** 日時変更を右ペインで開く。 */
  onReschedule: (appointmentId: string) => void;
}

export function KarteAppointmentTab({ patientId, onReschedule }: KarteAppointmentTabProps) {
  const { appointments, isLoading, error } = useAppointmentSearch(patientId);
  const cancel = useCancelAppointment();

  function handleCancel(appointment: fhir4.Appointment) {
    if (
      !window.confirm(
        `${appointmentDateTimeLabel(appointment)} の予約を取り消します。よろしいですか?`,
      )
    ) {
      return;
    }
    cancel.mutate(appointment);
  }

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>予約</h3>
      </div>

      <ErrorBanner error={error} />
      <ErrorBanner error={cancel.error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <AppointmentTable
          appointments={appointments}
          onReschedule={onReschedule}
          onCancel={handleCancel}
          busy={cancel.isPending}
        />
      )}
    </div>
  );
}
