import { usePatientTodayOutpatient } from "../api/queries";
import { useWaitingBoardInUse } from "../api/waitingBoardQueries";
import { appointmentReceptionNumber } from "../fhir/appointmentHelpers";

// カルテの「患者呼出」(components/PatientCallModal.tsx)で呼び出す今日の受付。

/** 呼び出す受付。boardInUse が false ならボタンを出さない。 */
export function usePatientCallTarget(patientId: string) {
  const boardInUse = useWaitingBoardInUse();
  const todayOutpatient = usePatientTodayOutpatient(boardInUse ? patientId : undefined);
  // 診察中・一時終了の予約も受付済のまま。
  const appointment = todayOutpatient.data?.exam?.appointment ?? todayOutpatient.data?.checkedInAppointment ?? null;
  const receptionNumber = appointment ? appointmentReceptionNumber(appointment) : "";
  return { boardInUse, appointment: receptionNumber ? appointment : null, receptionNumber };
}
