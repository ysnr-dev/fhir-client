import { Modal } from "./Modal";

// カルテの「診察終了」で、当日の未実施の検査オーダーがあるときに出す。検査を受けに
// 診察室を離れるだけなら一時終了にし、結果を見てから診察再開・診察終了する。

interface Props {
  /** 未実施の検査オーダー(「検体検査: 血算」など)。 */
  pendingOrders: string[];
  submitting?: boolean;
  onPause: () => void;
  onFinish: () => void;
  onCancel: () => void;
}

export function ExamFinishChoiceModal({ pendingOrders, submitting, onPause, onFinish, onCancel }: Props) {
  return (
    <Modal title="未実施の検査があります" onClose={onCancel} className="modal--exam-finish-choice">
      <ul className="exam-finish-choice__list">
        {pendingOrders.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
      <div className="lab-order-item__actions">
        <button type="button" onClick={onPause} disabled={submitting}>
          一時終了
        </button>
        <button type="button" onClick={onFinish} disabled={submitting}>
          診察終了
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          戻る
        </button>
      </div>
    </Modal>
  );
}
