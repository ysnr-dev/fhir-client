import { useState } from "react";
import { useDischargePatient } from "../api/queries";
import {
  encounterAdmissionDate,
  validateDischargeDate,
} from "../fhir/encounterHelpers";
import { displayName } from "../fhir/patientHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 退院。入院取消(誤登録)と違って退院日を残すので、日付だけ聞く小さなモーダルにする。

interface DischargeModalProps {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  bedLabel: string;
  onClose: () => void;
}

export function DischargeModal({ encounter, patient, bedLabel, onClose }: DischargeModalProps) {
  const [dischargeDate, setDischargeDate] = useState(today);
  const [validationError, setValidationError] = useState<string | null>(null);
  const discharge = useDischargePatient();

  function handleSubmit() {
    const error = validateDischargeDate(encounter, dischargeDate);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    discharge.mutate({ encounter, dischargeDate }, { onSuccess: onClose });
  }

  return (
    <Modal title="退院" onClose={onClose}>
      <ErrorBanner error={discharge.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__patient">
          <span>{patient ? displayName(patient) : "(患者不明)"}</span>
          <span>{bedLabel}</span>
        </div>

        <div className="walk-in__fields">
          <label>
            入院日
            <input type="text" value={encounterAdmissionDate(encounter)} readOnly />
          </label>
          <label>
            退院日(必須)
            <input
              type="date"
              value={dischargeDate}
              onChange={(e) => setDischargeDate(e.target.value)}
            />
          </label>
        </div>

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={discharge.isPending}>
            {discharge.isPending ? "退院処理中..." : "退院"}
          </button>
          <button type="button" onClick={onClose} disabled={discharge.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
