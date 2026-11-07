import { useState } from "react";
import { useUpdateLineDrainProcedure } from "../api/queries";
import {
  lineDrainLabel,
  REMOVAL_REASON_OPTIONS,
  removeLineDrain,
  validateRemoval,
  type LineDrainRecord,
  type LineDrainRemovalReason,
} from "../fhir/lineDrainHelpers";
import { dateTimeLabel, nowDateTimeInput } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

/**
 * 留置中の管の抜去(docs/line-drain-design.md §2)。抜去日時・区分・コメントを入れ、
 * 読んだ Procedure を completed に書き換えて PUT する。
 */
export function LineDrainRemovalModal({ record, onClose }: { record: LineDrainRecord; onClose: () => void }) {
  const update = useUpdateLineDrainProcedure();
  const [removedAt, setRemovedAt] = useState(() => nowDateTimeInput());
  const [reason, setReason] = useState<LineDrainRemovalReason | "">("planned");
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit() {
    const values = { removedAt, reason, note };
    const message = validateRemoval(values, record);
    setValidationError(message);
    if (message) return;
    update.mutate(removeLineDrain(record.procedure, values), { onSuccess: onClose });
  }

  return (
    <Modal title="抜去" onClose={onClose}>
      <ErrorBanner error={update.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__patient">
          <span>{lineDrainLabel(record)}</span>
          {record.deviceLabel && <span>{record.deviceLabel}</span>}
          <span>{`挿入 ${dateTimeLabel(record.insertedAt)}`}</span>
        </div>

        <div className="walk-in__fields">
          <label>
            抜去日時
            <input type="datetime-local" value={removedAt} onChange={(e) => setRemovedAt(e.target.value)} />
          </label>
          <label>
            区分
            <select value={reason} onChange={(e) => setReason(e.target.value as LineDrainRemovalReason | "")}>
              {REMOVAL_REASON_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            コメント
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={update.isPending}>
            抜去
          </button>
          <button type="button" onClick={onClose} disabled={update.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
