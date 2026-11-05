import { useState } from "react";
import { DELETE_REASON_SUGGESTIONS } from "../lib/deleteReasonStage";
import { Modal } from "./Modal";

// カルテのカードの削除確認。理由を入れさせ、削除の来歴に残す(docs/features/karte.md「削除の記録」)。
// 理由は呼ぶ側が lib/deleteReasonStage に置いてから削除を始める。

export function KarteDeleteModal({
  title,
  warning,
  onDelete,
  onClose,
}: {
  title: string;
  /** 化学療法の投与日など、消すと他に響くものの注意。 */
  warning?: string;
  onDelete: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <Modal title={title} onClose={onClose} className="modal--karte-delete">
      {warning && <p className="injection-scope__note">{warning}</p>}
      <div className="walk-in__fields karte-delete-form">
        <label className="karte-delete-form__reason">
          理由
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            list="karte-delete-reasons"
            autoFocus
          />
          <datalist id="karte-delete-reasons">
            {DELETE_REASON_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="chart-editor__actions">
        <button type="button" onClick={() => onDelete(reason.trim())} disabled={!reason.trim()}>
          削除
        </button>
        <button type="button" onClick={onClose}>
          取消
        </button>
      </div>
    </Modal>
  );
}
