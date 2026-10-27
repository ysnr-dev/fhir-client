import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 診察開始で待合表示板に受付番号を呼び出すかどうかの確認(docs/waiting-board-design.md §3.2)。
// 待合表示板を使っていて(有効なリンクがある)受付番号のある受付だけに出す。
// 「呼出」は表示板の「お呼び出し中」に番号を出し、「呼出なし」は診察だけを始める(検査から戻った人の続きなど)。

interface Props {
  receptionNumber: string;
  patientName: string;
  pending: boolean;
  error: unknown;
  onStart: (boardCall: boolean) => void;
  onClose: () => void;
}

export function ExamStartCallModal({ receptionNumber, patientName, pending, error, onStart, onClose }: Props) {
  return (
    <Modal title="診察開始" onClose={onClose}>
      <ErrorBanner error={error} />
      <p className="exam-start-call__message">
        受付番号 <span className="exam-start-call__number">{receptionNumber}</span>
        {patientName ? ` ${patientName} さん` : ""}を呼び出しますか?
      </p>
      {/* Modal は非ポータル。type="button" を必ず付ける(外側フォームの送信を防ぐ)。 */}
      <div className="lab-order-item__actions">
        <button type="button" disabled={pending} onClick={() => onStart(true)}>
          呼出
        </button>
        <button type="button" disabled={pending} onClick={() => onStart(false)}>
          呼出なし
        </button>
        <button type="button" disabled={pending} onClick={onClose}>
          戻る
        </button>
      </div>
    </Modal>
  );
}
