import { Modal } from "./Modal";
import { RadiotherapyAdverseEventPanel } from "./RadiotherapyAdverseEventPanel";
import { RadiotherapyReviewPanel } from "./RadiotherapyReviewPanel";
import { RegimenAdverseEventPanel } from "./RegimenAdverseEventPanel";

// 治療(化学療法のクール・放射線治療のコース)に付ける記録のモーダル。有害事象と週次レビューは
// 治療の評価なので、右ペインではなく開いた場所(化学療法タブ・カルテのカード・通知のリンク)に重ねる。

export type TreatmentRecordTarget =
  /** クールの有害事象(CTCAE Grade)。regimenSrId は適用のヘッダ ServiceRequest。 */
  | { kind: "regimen-adverse"; regimenSrId: string; cycle: number }
  /** 放射線治療コースの有害事象。srId は治療処方。 */
  | { kind: "radiotherapy-adverse"; srId: string }
  /** 放射線治療コースの週次レビュー(治療中の診察)。テンプレート回答として残す。 */
  | { kind: "radiotherapy-review"; srId: string };

const TITLES: Record<TreatmentRecordTarget["kind"], string> = {
  "regimen-adverse": "化学療法(有害事象)",
  "radiotherapy-adverse": "放射線治療(有害事象)",
  "radiotherapy-review": "放射線治療(週次レビュー)",
};

export function TreatmentRecordModal({
  patientId,
  target,
  onClose,
}: {
  patientId: string;
  target: TreatmentRecordTarget;
  onClose: () => void;
}) {
  return (
    <Modal title={TITLES[target.kind]} className="modal--wide" onClose={onClose}>
      {target.kind === "regimen-adverse" ? (
        <RegimenAdverseEventPanel patientId={patientId} regimenSrId={target.regimenSrId} cycle={target.cycle} />
      ) : target.kind === "radiotherapy-adverse" ? (
        <RadiotherapyAdverseEventPanel patientId={patientId} srId={target.srId} />
      ) : (
        <RadiotherapyReviewPanel patientId={patientId} srId={target.srId} onSaved={onClose} />
      )}
    </Modal>
  );
}
