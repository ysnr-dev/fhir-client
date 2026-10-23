import { useAppointmentSearch, useCancelAppointment } from "../api/queries";
import {
  appointmentDateTimeLabel,
} from "../fhir/appointmentHelpers";
import { AppointmentTable } from "./AppointmentTable";
import { ErrorBanner } from "./ErrorBanner";
import { useState } from "react";
import { usePatient } from "../api/queries";
import { displayName } from "../fhir/patientHelpers";
import { addMonths, today } from "../lib/dates";
import { IntakeQrModal } from "./IntakeQrModal";

// カルテ画面の「予約」タブ。その患者の予約を一覧し、取消を行う。
//
// 登録と日時変更はどちらも枠を選ぶ操作で、右ペイン(AppointmentPanels)の担当。
// 左ペインは一覧に徹する。予約はカルテのカードにしない方針なので、
// タイムラインとは連動しない。

interface KarteAppointmentTabProps {
  patientId: string;
  /** 表示の既定を決める日(診療ダッシュボードの基準日)。無ければ今日。 */
  baseDate?: string;
  /** 日時変更を右ペインで開く。 */
  onReschedule: (appointmentId: string) => void;
}

export function KarteAppointmentTab({ patientId, onReschedule, baseDate }: KarteAppointmentTabProps) {
  const [period, setPeriod] = useState<"all" | "range">("range");
  const [from, setFrom] = useState(() => addMonths(baseDate ?? today(), -1));
  const [to, setTo] = useState("");
  const ranged = period === "range";
  const { appointments, isLoading, error } = useAppointmentSearch(
    patientId,
    ranged ? from || undefined : undefined,
    ranged ? to || undefined : undefined,
  );
  const cancel = useCancelAppointment();
  const { data: patientResult } = usePatient(patientId);
  const [intakeTarget, setIntakeTarget] = useState<fhir4.Appointment | null>(null);

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
      <div className="patient-chart__toolbar">
        <h3 className="patient-chart__title">予約</h3>
        <select
          value={period}
          aria-label="表示期間"
          onChange={(e) => setPeriod(e.target.value as "all" | "range")}
        >
          <option value="all">全期間</option>
          <option value="range">期間指定</option>
        </select>
        {ranged && (
          <div className="patient-chart__nav">
            <input type="date" value={from} aria-label="開始日" onChange={(e) => setFrom(e.target.value)} />
            〜
            <input type="date" value={to} aria-label="終了日" onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
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
          onIntakeQr={setIntakeTarget}
        />
      )}
      {intakeTarget && (
        <IntakeQrModal
          appointmentId={intakeTarget.id}
          patientName={patientResult?.data ? displayName(patientResult.data) : ""}
          onClose={() => setIntakeTarget(null)}
        />
      )}
    </div>
  );
}
