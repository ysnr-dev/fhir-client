import { useState } from "react";
import { useUpdateEncounter } from "../api/queries";
import {
  buildDischargePlanEncounter,
  encounterAdmissionDate,
  encounterDischargePlan,
  validateDischargePlan,
} from "../fhir/encounterHelpers";
import { displayName } from "../fhir/patientHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 退院予定。退院(DischargeModal)とは別で、予定日と理由を入院(Encounter)に
// メモするだけ。予定は 1 件だけで、登録し直すと置き換わる。

export function DischargePlanModal({
  encounter,
  patient,
  onClose,
}: {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  onClose: () => void;
}) {
  const existing = encounterDischargePlan(encounter);
  const [date, setDate] = useState(existing?.date || today());
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);
  const save = useUpdateEncounter();

  function handleSubmit() {
    const plan = { date, reason };
    const error = validateDischargePlan(encounter, plan);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    save.mutate(buildDischargePlanEncounter(encounter, plan), { onSuccess: onClose });
  }

  function handleClear() {
    if (!window.confirm("退院予定を取り消します。よろしいですか?")) return;
    save.mutate(buildDischargePlanEncounter(encounter, null), { onSuccess: onClose });
  }

  return (
    <Modal title="退院予定" onClose={onClose}>
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
            入院日
            <input type="text" value={encounterAdmissionDate(encounter)} readOnly />
          </label>
          <label>
            退院予定日(必須)
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="admission__note">
            退院理由
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={save.isPending}>
            {save.isPending ? "登録中..." : existing ? "予定を更新" : "予定を登録"}
          </button>
          {existing && (
            <button type="button" onClick={handleClear} disabled={save.isPending}>
              予定を取消
            </button>
          )}
          <button type="button" onClick={onClose} disabled={save.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
