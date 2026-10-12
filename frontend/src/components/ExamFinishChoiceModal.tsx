import { Modal } from "./Modal";

// カルテの「診察終了」で、当日の未実施の検査オーダーがあるときに出す。検査を受けに
// 診察室を離れるだけなら一時終了にし、結果を見てから診察再開・診察終了する。

interface Props {
  /** 未実施の検査オーダー(「検体検査: 血算」など)。 */
  pendingOrders: string[];
  onPause: () => void;
  onFinish: () => void;
  onCancel: () => void;
}

export function ExamFinishChoiceModal({ pendingOrders, onPause, onFinish, onCancel }: Props) {
  return (
    <Modal title="未実施の検査があります" onClose={onCancel} className="modal--exam-finish-choice">
      <ul className="exam-finish-choice__list">
        {pendingOrders.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
      <div className="exam-finish-choice__actions">
        <button type="button" onClick={onPause}>
          一時終了
        </button>
        <button type="button" onClick={onFinish}>
          診察終了
        </button>
        <button type="button" onClick={onCancel}>
          戻る
        </button>
      </div>
    </Modal>
  );
}
