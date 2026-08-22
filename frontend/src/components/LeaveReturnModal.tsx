import { useState } from "react";
import { useUpdateEncounter } from "../api/queries";
import {
  buildLeaveReturnedEncounter,
  validateLeaveReturn,
  type LeaveValues,
} from "../fhir/encounterHelpers";
import { displayName } from "../fhir/patientHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 帰院実施。外出泊の終了日を、実際に戻った日で確定する。
// 予定として入れてあった終了日があれば、それを初期値にする。

export function LeaveReturnModal({
  encounter,
  patient,
  leave,
  leaveIndex,
  onClose,
}: {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  leave: LeaveValues;
  /** encounterLeaves の並びでの位置。同じ患者に外出泊が複数あるので要る。 */
  leaveIndex: number;
  onClose: () => void;
}) {
  const [returnDate, setReturnDate] = useState(leave.end || today());
  const [validationError, setValidationError] = useState<string | null>(null);
  const save = useUpdateEncounter();

  function handleSubmit() {
    const error = validateLeaveReturn(leave, returnDate);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    save.mutate(buildLeaveReturnedEncounter(encounter, leaveIndex, returnDate), {
      onSuccess: onClose,
    });
  }

  return (
    <Modal title="帰院実施" onClose={onClose}>
      <ErrorBanner error={save.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__patient">
          <span>{patient ? displayName(patient) : "(患者不明)"}</span>
        </div>

        <div className="walk-in__fields">
          <label>
            外出泊開始日
            <input type="text" value={leave.start} readOnly />
          </label>
          <label>
            帰院日(必須)
            <input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </label>
          {leave.reason && (
            <label className="admission__note">
              外出泊理由
              <textarea rows={2} value={leave.reason} readOnly />
            </label>
          )}
        </div>

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={save.isPending}>
            {save.isPending ? "登録中..." : "帰院実施"}
          </button>
          <button type="button" onClick={onClose} disabled={save.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
