import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { displayName } from "../fhir/patientHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { AdmissionPatientSearch } from "./AdmissionModal";
import { Modal } from "./Modal";
import { RadiotherapyOrderCreatePanel } from "./RadiotherapyOrderPanels";

// 放射線治療カレンダーから治療処方を登録するためのモーダル。
//
// 中身はカルテ右ペインと**同じ** RadiotherapyOrderCreatePanel。放射線治療科が使う入口を
// 増やすだけで、処方の中身(標的・線量・分割・装置)を二重に持たない。
//
// カレンダーからの登録はカルテと違って患者が決まっていないので、手術オーダーの登録
// (SurgeryOrderCreateModal)と同じ「患者を選ぶ → 中身を書く」の 2 段階にする。

export function RadiotherapyOrderCreateModal({ onClose }: { onClose: () => void }) {
  const [patient, setPatient] = useState<fhir4.Patient | null>(null);
  const queryClient = useQueryClient();
  // 依頼科・依頼医師はヘッダーの選択(カルテと共通)を使う。未選択でも登録は通る
  // (requester が付かないだけ)ので、止めずに気づけるようにだけしておく。
  const requester = useOrderContext();
  const noRequester = !requester.departmentId && !requester.practitionerId;

  function handleSaved() {
    // 登録の mutation は他オーダーと共用で ["ServiceRequest","search"] しか無効化しない。
    // 右の治療コース一覧は別のキーなので、ここで落として登録直後のカードを出す。
    queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "radiotherapy-worklist"] });
    onClose();
  }

  return (
    <Modal title="放射線治療オーダー登録" onClose={onClose} className="modal--lab-order-item">
      {noRequester && (
        <p className="order-select__muted">
          依頼科・依頼医師が未選択です。画面上部の「依頼」から選ぶと登録するオーダーに残ります。
        </p>
      )}

      {patient?.id ? (
        <>
          <div className="walk-in__patient">
            <span>{patient.identifier?.[0]?.value ?? "-"}</span>
            <span>{displayName(patient)}</span>
            <button type="button" onClick={() => setPatient(null)}>
              選び直す
            </button>
          </div>
          {/* 患者を選び直したらフォームを作り直す(初期値は初回描画時にしか読まれない)。 */}
          <RadiotherapyOrderCreatePanel
            key={patient.id}
            patientId={patient.id}
            onSaved={handleSaved}
          />
        </>
      ) : (
        <AdmissionPatientSearch onSelect={setPatient} />
      )}
    </Modal>
  );
}
