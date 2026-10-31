import { useState } from "react";
import { useSaveAdverseEvent } from "../api/queries";
import {
  adverseEventRefOf,
  adverseEventTreatmentLabel,
  buildAdverseEvent,
  formValuesOf,
  validateAdverseEvent,
  type AdverseEventRecord,
} from "../fhir/adverseEventHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

/**
 * 継続中の有害事象に回復日を入れる(プロファイルの「有害事象」区画から)。
 * 用語・Grade・発現日は治療の側の記録パネルで直すので、ここでは回復日と対処・経過だけを扱う。
 */
export function AdverseEventRecoveryModal({
  patientId,
  record,
  onClose,
}: {
  patientId: string;
  record: AdverseEventRecord;
  onClose: () => void;
}) {
  const save = useSaveAdverseEvent();
  const [resolved, setResolved] = useState(() => today());
  const [note, setNote] = useState(record.note);
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit() {
    const values = { ...formValuesOf(record), resolved, note };
    const message = resolved ? validateAdverseEvent(values) : "回復日を入力してください";
    setValidationError(message);
    if (message) return;
    save.mutate(
      // 記録者は元のまま(回復を入れた人で上書きしない)。
      buildAdverseEvent(values, patientId, adverseEventRefOf(record), record.id, record.performer),
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="回復の登録" onClose={onClose}>
      <ErrorBanner error={save.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__patient">
          <span className={`regimen-adverse__grade regimen-adverse__grade--${record.grade}`}>G{record.grade}</span>
          <span>{record.term}</span>
          <span>{`${record.onset} 〜`}</span>
          <span>{adverseEventTreatmentLabel(record)}</span>
        </div>

        <div className="walk-in__fields">
          <label>
            回復日
            <input type="date" value={resolved} onChange={(e) => setResolved(e.target.value)} />
          </label>
          <label>
            対処・経過
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={save.isPending}>
            登録
          </button>
          <button type="button" onClick={onClose} disabled={save.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
