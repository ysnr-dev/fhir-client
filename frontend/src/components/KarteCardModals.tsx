import {
  useClinicalNote,
  usePrescriptionDetail,
  useQuestionnaireResponseWithQuestionnaire,
} from "../api/queries";
import { KARTE_KIND_LABELS, type KarteTimelineItem } from "../fhir/karteTimeline";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { splitPrescriptionDetailBundle } from "../fhir/prescriptionHelpers";
import type { KarteDetailTarget } from "../karteUrl";
import { ClinicalNoteDetailPanel } from "./ClinicalNoteDetailPanel";
import { ErrorBanner } from "./ErrorBanner";
import { FhirJsonView } from "./FhirJsonView";
import { InjectionDetailPanel } from "./InjectionDetailPanel";
import { Modal } from "./Modal";
import { PrescriptionDetailPanel } from "./PrescriptionDetailPanel";
import { QuestionnaireResponseDetailPanel } from "./QuestionnaireResponseDetailPanel";

// カルテのタイムラインから開くモーダル。詳細表示は各リソースの詳細ページと同じ
// パネルを使うので、カードでは省いている情報(処方の DI リンクなど)も参照できる。

const DETAIL_TITLES: Record<KarteTimelineItem["kind"], string> = {
  note: "診療記録詳細",
  prescription: "処方内容",
  injection: "注射内容",
  qr: "テンプレート表示",
};

// 対象は URL から来るので、タイムラインに読み込み済みかどうかに関わらず
// ID から引き直す。別患者の ID を指す URL は内容を出さない。
export function KarteDetailModal({
  patientId,
  target,
  problemsById,
  onClose,
}: {
  patientId: string;
  target: KarteDetailTarget;
  problemsById: Map<string, fhir4.Condition>;
  onClose: () => void;
}) {
  return (
    <Modal title={DETAIL_TITLES[target.kind]} onClose={onClose} className="modal--wide">
      {target.kind === "note" ? (
        <NoteDetail patientId={patientId} noteId={target.id} />
      ) : target.kind === "prescription" ? (
        <PrescriptionDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "injection" ? (
        <InjectionDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : (
        <QuestionnaireResponseDetail patientId={patientId} qrId={target.id} />
      )}
    </Modal>
  );
}

function NotFound({ label }: { label: string }) {
  return (
    <p className="patient-table__empty">
      この{label}は見つかりません(削除された可能性があります)。
    </p>
  );
}

function NoteDetail({ patientId, noteId }: { patientId: string; noteId: string }) {
  const { data: result, isLoading, error } = useClinicalNote(noteId);
  const note = result?.data;
  const mismatch = isPatientMismatch(patientId, note?.subject);

  return (
    <>
      <ErrorBanner error={error} />
      {isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された診療記録は別の患者のものです。</p>
      ) : note ? (
        <ClinicalNoteDetailPanel note={note} />
      ) : (
        !error && <NotFound label="診療記録" />
      )}
    </>
  );
}

function PrescriptionDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = usePrescriptionDetail(srId);
  const { serviceRequest, medicationRequests } = detail.data
    ? splitPrescriptionDetailBundle(detail.data.data)
    : { serviceRequest: undefined, medicationRequests: [] };
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された処方は別の患者のものです。</p>
      ) : serviceRequest ? (
        <PrescriptionDetailPanel
          serviceRequest={serviceRequest}
          medicationRequests={medicationRequests}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="処方" />
      )}
    </>
  );
}

// 注射も処方と同じ ServiceRequest 詳細検索(SR + _revinclude の MR)で取得する。
function InjectionDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = usePrescriptionDetail(srId);
  const { serviceRequest, medicationRequests } = detail.data
    ? splitPrescriptionDetailBundle(detail.data.data)
    : { serviceRequest: undefined, medicationRequests: [] };
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された注射は別の患者のものです。</p>
      ) : serviceRequest ? (
        <InjectionDetailPanel
          serviceRequest={serviceRequest}
          medicationRequests={medicationRequests}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="注射" />
      )}
    </>
  );
}

function QuestionnaireResponseDetail({ patientId, qrId }: { patientId: string; qrId: string }) {
  const { response, questionnaire, isLoading, error } =
    useQuestionnaireResponseWithQuestionnaire(qrId);
  const mismatch = isPatientMismatch(patientId, response?.subject);

  return (
    <>
      <ErrorBanner error={error} />
      {isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定されたテンプレートは別の患者のものです。</p>
      ) : response ? (
        <QuestionnaireResponseDetailPanel response={response} questionnaire={questionnaire} />
      ) : (
        !error && <NotFound label="テンプレート" />
      )}
    </>
  );
}

// FHIR JSON はタイムラインに読み込み済みのカードからしか開かないので、
// 手元のリソースをそのまま出す(処方だけは Bundle で見せたいので引き直す)。
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
      {item.kind === "prescription" || item.kind === "injection" ? (
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
