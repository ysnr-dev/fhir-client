import { usePrescriptionDetail } from "../api/queries";
import { KARTE_KIND_LABELS, type KarteTimelineItem } from "../fhir/karteTimeline";
import { ClinicalNoteDetailPanel } from "./ClinicalNoteDetailPanel";
import { ErrorBanner } from "./ErrorBanner";
import { FhirJsonView } from "./FhirJsonView";
import { Modal } from "./Modal";
import { PrescriptionDetailPanel } from "./PrescriptionDetailPanel";
import { QuestionnaireResponseDetailPanel } from "./QuestionnaireResponseDetailPanel";

// カルテのタイムラインカードから開くモーダル。詳細表示は各リソースの詳細ページと
// 同じパネルを使うので、カルテ画面のカードでは省いている情報(処方の DI リンクや
// テンプレートのシェーマ画像など)もここで参照できる。

const DETAIL_TITLES: Record<KarteTimelineItem["kind"], string> = {
  note: "診療記録詳細",
  prescription: "処方内容",
  qr: "テンプレート表示",
};

export function KarteCardDetailModal({
  item,
  problemsById,
  onClose,
}: {
  item: KarteTimelineItem;
  problemsById: Map<string, fhir4.Condition>;
  onClose: () => void;
}) {
  return (
    <Modal title={DETAIL_TITLES[item.kind]} onClose={onClose} className="modal--wide">
      {item.kind === "note" ? (
        <ClinicalNoteDetailPanel note={item.note} />
      ) : item.kind === "prescription" ? (
        <PrescriptionDetailPanel
          serviceRequest={item.serviceRequest}
          medicationRequests={item.medicationRequests}
          problemsById={problemsById}
        />
      ) : (
        <QuestionnaireResponseDetailPanel
          response={item.response}
          questionnaire={item.questionnaire}
        />
      )}
    </Modal>
  );
}

export function KarteCardJsonModal({
  item,
  onClose,
}: {
  item: KarteTimelineItem;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`FHIR JSON(${KARTE_KIND_LABELS[item.kind]})`}
      onClose={onClose}
      className="modal--wide"
    >
      {item.kind === "prescription" ? (
        <PrescriptionJson srId={item.id} />
      ) : (
        <FhirJsonView resource={item.kind === "note" ? item.note : item.response} />
      )}
    </Modal>
  );
}

// 処方は ServiceRequest と MedicationRequest をまとめた Bundle で見せたいので、
// 処方内容ページと同じ検索を実行する(モーダルを開いたときだけ走る)。
function PrescriptionJson({ srId }: { srId: string }) {
  const detail = usePrescriptionDetail(srId);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? <p>読み込み中...</p> : <FhirJsonView resource={detail.data?.data} />}
    </>
  );
}
