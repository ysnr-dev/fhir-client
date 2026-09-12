import { useState } from "react";
import { displayName } from "../fhir/patientHelpers";
import { AdmissionPatientSearch } from "./AdmissionModal";
import { Modal } from "./Modal";
import { PlannedAdmissionForm } from "./PlannedAdmissionForm";

// 入院予定の新規登録。入院登録(AdmissionModal)と同じ二段構えで、まず患者を探し、
// 選んでから入院予定を入力する。行(ベッド)からではなく一覧のボタンから開くので、
// 病棟・病室・ベッドも入力側で選ぶ(PlannedAdmissionForm)。

export function PlannedAdmissionModal({
  defaultWardId,
  onClose,
}: {
  /** 病棟の既定値。一覧で見ている病棟を渡す。 */
  defaultWardId?: string;
  onClose: () => void;
}) {
  const [patient, setPatient] = useState<fhir4.Patient | null>(null);

  return (
    <Modal title="入院予定の登録" onClose={onClose} className="modal--wide">
      {patient ? (
        <PlannedAdmissionForm
          patient={patient}
          defaultWardId={defaultWardId}
          header={(submitting) => (
            <div className="walk-in__patient">
              <span>{patient.identifier?.[0]?.value ?? "-"}</span>
              <span>{displayName(patient)}</span>
              <button type="button" onClick={() => setPatient(null)} disabled={submitting}>
                選び直す
              </button>
            </div>
          )}
          onSaved={onClose}
          onCancel={onClose}
        />
      ) : (
        <AdmissionPatientSearch onSelect={setPatient} />
      )}
    </Modal>
  );
}
