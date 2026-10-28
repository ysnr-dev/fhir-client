import { useCallOutpatient, usePatient } from "../api/queries";
import { displayName } from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// カルテ右のボタン列の「患者呼出」(karteMenu の action 項目。docs/waiting-board-design.md §3.2)。診察開始とは別に、いつでも
// 今日の受付の番号を待合表示板の「お呼び出し中」に出す(来ない人の呼び直し、検査から戻った人の呼び戻しなど)。
// 待合表示板を使っている施設だけにボタンを出し、今日の受付に番号が無ければ押せない。

// ボタン列(.karte-right__actions)のボタンの寸法を受けないよう、列の外に置く。
export function PatientCallModal({
  patientId,
  appointment,
  receptionNumber,
  onClose,
}: {
  patientId: string;
  appointment: fhir4.Appointment;
  receptionNumber: string;
  onClose: () => void;
}) {
  const patient = usePatient(patientId);
  const call = useCallOutpatient();
  const patientName = patient.data?.data ? displayName(patient.data.data) : "";

  return (
    <Modal title="患者呼出" onClose={onClose}>
      <ErrorBanner error={call.error} />
      <p className="exam-start-call__message">
        受付番号 <span className="exam-start-call__number">{receptionNumber}</span>
        {patientName ? ` ${patientName} さん` : ""}を呼び出しますか?
      </p>
      {/* Modal は非ポータル。type="button" を必ず付ける(外側フォームの送信を防ぐ)。 */}
      <div className="lab-order-item__actions">
        <button type="button" disabled={call.isPending} onClick={() => call.mutate(appointment, { onSuccess: onClose })}>
          呼出
        </button>
        <button type="button" disabled={call.isPending} onClick={onClose}>
          戻る
        </button>
      </div>
    </Modal>
  );
}
