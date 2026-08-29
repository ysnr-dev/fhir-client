import {
  useClinicalNote,
  useLabOrderDetail,
  useMicroOrderDetail,
  usePathoOrderDetail,
  usePathoResultDetail,
  useMicroResultDetail,
  useRadOrderDetail,
  useRadPerformDetail,
  usePhysioOrderDetail,
  usePhysioPerformDetail,
  useEndoscopyOrderDetail,
  useEndoscopyPerformDetail,
  useMealOrderDetail,
  useRehabOrderDetail,
  useTransfusionOrderDetail,
  useTransfusionPerformDetail,
  useTreatmentOrderDetail,
  useSurgeryOrderDetail,
  useSurgeryPerformDetail,
  useTreatmentPerformDetail,
  useLabResultDetail,
  usePrescriptionDetail,
  useQuestionnaireResponseWithQuestionnaire,
} from "../api/queries";
import { KARTE_KIND_LABELS, type KarteTimelineItem } from "../fhir/karteTimeline";
import { labOrderItemRequests, serviceRequestsOf } from "../fhir/labOrderHelpers";
import { microOrderItemRequests } from "../fhir/microOrderHelpers";
import { pathoOrderItemRequests } from "../fhir/pathoOrderHelpers";
import { radOrderItemRequests } from "../fhir/radOrderHelpers";
import { physioOrderItemRequests } from "../fhir/physioOrderHelpers";
import { endoscopyOrderItemRequests } from "../fhir/endoscopyOrderHelpers";
import { treatmentOrderItemRequests } from "../fhir/treatmentOrderHelpers";
import { transfusionOrderItemRequests } from "../fhir/transfusionOrderHelpers";
import { MealOrderDetailPanel } from "./MealOrderDetailPanel";
import { surgeryOrderItemRequests } from "../fhir/surgeryOrderHelpers";
import { splitLabResultDetailBundle } from "../fhir/labResultHelpers";
import { splitMicroResultDetailBundle } from "../fhir/microResultHelpers";
import { splitPathoResultDetailBundle } from "../fhir/pathoResultHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { splitPrescriptionDetailBundle } from "../fhir/prescriptionHelpers";
import type { KarteDetailKind, KarteDetailTarget } from "../karteUrl";
import { ClinicalNoteDetailPanel } from "./ClinicalNoteDetailPanel";
import { ErrorBanner } from "./ErrorBanner";
import { FhirJsonView } from "./FhirJsonView";
import { InjectionDetailPanel } from "./InjectionDetailPanel";
import { LabOrderDetailPanel } from "./LabOrderDetailPanel";
import { LabResultDetailPanel } from "./LabResultDetailPanel";
import { Modal } from "./Modal";
import { MicroOrderDetailPanel } from "./MicroOrderDetailPanel";
import { MicroResultDetailPanel } from "./MicroResultDetailPanel";
import { PathoOrderDetailPanel } from "./PathoOrderDetailPanel";
import { PathoResultDetailPanel } from "./PathoResultDetailPanel";
import { PrescriptionDetailPanel } from "./PrescriptionDetailPanel";
import { QuestionnaireResponseDetailPanel } from "./QuestionnaireResponseDetailPanel";
import { RadOrderDetailPanel } from "./RadOrderDetailPanel";
import { PhysioOrderDetailPanel } from "./PhysioOrderDetailPanel";
import { EndoscopyOrderDetailPanel } from "./EndoscopyOrderDetailPanel";
import { TreatmentOrderDetailPanel } from "./TreatmentOrderDetailPanel";
import { SurgeryOrderDetailPanel } from "./SurgeryOrderDetailPanel";
import { TransfusionOrderDetailPanel } from "./TransfusionOrderDetailPanel";
import { RehabOrderDetailPanel } from "./RehabOrderDetailPanel";
import { rehabPerformsByOrderId } from "../fhir/rehabResultHelpers";

// カルテのタイムラインから開くモーダル。詳細表示は各リソースの詳細ページと同じ
// パネルを使うので、カードでは省いている情報(処方の DI リンクなど)も参照できる。

const DETAIL_TITLES: Record<KarteDetailKind, string> = {
  note: "診療記録詳細",
  prescription: "処方内容",
  injection: "注射内容",
  "lab-order": "検体検査内容",
  "micro-order": "細菌検査内容",
  "patho-order": "病理検査内容",
  "rad-order": "放射線検査内容",
  "physio-order": "生理検査内容",
  "endoscopy-order": "内視鏡内容",
  "treatment-order": "処置内容",
  "surgery-order": "手術内容",
  "meal-order": "食事内容",
  "transfusion-order": "輸血内容",
  "rehab-order": "リハビリ内容",
  "lab-result": "検査結果内容",
  "micro-result": "細菌検査結果内容",
  "patho-result": "病理診断レポート",
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
      ) : target.kind === "lab-order" ? (
        <LabOrderDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "micro-order" ? (
        <MicroOrderDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "patho-order" ? (
        <PathoOrderDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "rad-order" ? (
        <RadOrderDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "physio-order" ? (
        <PhysioOrderDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "endoscopy-order" ? (
        <EndoscopyOrderDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "treatment-order" ? (
        <TreatmentOrderDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "surgery-order" ? (
        <SurgeryOrderDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "meal-order" ? (
        <MealOrderDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "transfusion-order" ? (
        <TransfusionOrderDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "rehab-order" ? (
        <RehabOrderDetail patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "lab-result" ? (
        <LabResultDetail patientId={patientId} reportId={target.id} />
      ) : target.kind === "micro-result" ? (
        <MicroResultDetail patientId={patientId} reportId={target.id} />
      ) : target.kind === "patho-result" ? (
        <PathoResultDetail patientId={patientId} reportId={target.id} />
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

// 検体検査は明細も ServiceRequest なので、ヘッダと明細を 1 リクエストで取る。
function LabOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useLabOrderDetail(srId);
  const requests = serviceRequestsOf(detail.data?.data);
  const serviceRequest = requests.find((request) => request.id === srId);
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された検体検査は別の患者のものです。</p>
      ) : serviceRequest ? (
        <LabOrderDetailPanel
          serviceRequest={serviceRequest}
          itemRequests={labOrderItemRequests(requests, srId)}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="検体検査" />
      )}
    </>
  );
}

// 細菌検査も明細(検体グループ・検査項目)が ServiceRequest なので、
// ヘッダと明細を 1 リクエストで取る。
function MicroOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useMicroOrderDetail(srId);
  const requests = serviceRequestsOf(detail.data?.data);
  const serviceRequest = requests.find((request) => request.id === srId);
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された細菌検査は別の患者のものです。</p>
      ) : serviceRequest ? (
        <MicroOrderDetailPanel
          serviceRequest={serviceRequest}
          itemRequests={microOrderItemRequests(requests, srId)}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="細菌検査" />
      )}
    </>
  );
}

// 放射線検査も明細が ServiceRequest なので、ヘッダと明細を 1 リクエストで取る。
function RadOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useRadOrderDetail(srId);
  const requests = serviceRequestsOf(detail.data?.data);
  const serviceRequest = requests.find((request) => request.id === srId);
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された放射線検査は別の患者のものです。</p>
      ) : serviceRequest ? (
        <RadOrderDetailPanel
          serviceRequest={serviceRequest}
          itemRequests={radOrderItemRequests(requests, srId)}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="放射線検査" />
      )}
    </>
  );
}

function PhysioOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = usePhysioOrderDetail(srId);
  const requests = serviceRequestsOf(detail.data?.data);
  const serviceRequest = requests.find((request) => request.id === srId);
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された生理検査は別の患者のものです。</p>
      ) : serviceRequest ? (
        <PhysioOrderDetailPanel
          serviceRequest={serviceRequest}
          itemRequests={physioOrderItemRequests(requests, srId)}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="生理検査" />
      )}
    </>
  );
}

function TreatmentOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useTreatmentOrderDetail(srId);
  const requests = serviceRequestsOf(detail.data?.data);
  const serviceRequest = requests.find((request) => request.id === srId);
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された処置は別の患者のものです。</p>
      ) : serviceRequest ? (
        <TreatmentOrderDetailPanel
          serviceRequest={serviceRequest}
          itemRequests={treatmentOrderItemRequests(requests, srId)}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="処置" />
      )}
    </>
  );
}

function MealOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useMealOrderDetail(srId);
  const serviceRequest = serviceRequestsOf(detail.data?.data).find(
    (request) => request.id === srId,
  );
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された食事オーダーは別の患者のものです。</p>
      ) : serviceRequest ? (
        <MealOrderDetailPanel serviceRequest={serviceRequest} problemsById={problemsById} />
      ) : (
        !detail.error && <NotFound label="食事オーダー" />
      )}
    </>
  );
}

// リハビリは実施記録が別リソースで、オーダーの検索に _revinclude で添えてある
// (useRehabOrderDetail)。実施履歴を全件並べたいので同じ応答から取り出す。
function RehabOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useRehabOrderDetail(srId);
  const serviceRequest = serviceRequestsOf(detail.data?.data).find(
    (request) => request.id === srId,
  );
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  const procedures = (detail.data?.data.entry ?? [])
    .map((entry) => entry.resource)
    .filter((r): r is fhir4.Procedure => r?.resourceType === "Procedure");
  const performs = rehabPerformsByOrderId(procedures).get(srId) ?? [];

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定されたリハビリオーダーは別の患者のものです。</p>
      ) : serviceRequest ? (
        <RehabOrderDetailPanel
          serviceRequest={serviceRequest}
          performs={performs}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="リハビリオーダー" />
      )}
    </>
  );
}

function SurgeryOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useSurgeryOrderDetail(srId);
  const requests = serviceRequestsOf(detail.data?.data);
  const serviceRequest = requests.find((request) => request.id === srId);
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された手術は別の患者のものです。</p>
      ) : serviceRequest ? (
        <SurgeryOrderDetailPanel
          serviceRequest={serviceRequest}
          itemRequests={surgeryOrderItemRequests(requests, srId)}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="手術" />
      )}
    </>
  );
}

function EndoscopyOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useEndoscopyOrderDetail(srId);
  const requests = serviceRequestsOf(detail.data?.data);
  const serviceRequest = requests.find((request) => request.id === srId);
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された内視鏡は別の患者のものです。</p>
      ) : serviceRequest ? (
        <EndoscopyOrderDetailPanel
          serviceRequest={serviceRequest}
          itemRequests={endoscopyOrderItemRequests(requests, srId)}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="内視鏡" />
      )}
    </>
  );
}

// 検体検査のカードから開く「検査結果表示」。中身は検査結果タブの内容表示と同じ
// パネルで、患者の取り違えだけここで弾く(パネルと同じクエリなので追加の取得は無い)。
function LabResultDetail({ patientId, reportId }: { patientId: string; reportId: string }) {
  const detail = useLabResultDetail(reportId);
  const report = detail.data ? splitLabResultDetailBundle(detail.data.data).report : undefined;
  const mismatch = isPatientMismatch(patientId, report?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された検査結果は別の患者のものです。</p>
      ) : report ? (
        <LabResultDetailPanel reportId={reportId} />
      ) : (
        !detail.error && <NotFound label="検査結果" />
      )}
    </>
  );
}

// 細菌検査のカードから開く「検査結果表示」。中身は細菌検査タブの内容表示と同じ
// パネルで、患者の取り違えだけここで弾く(パネルと同じクエリなので追加の取得は無い)。
function PathoOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = usePathoOrderDetail(srId);
  const requests = serviceRequestsOf(detail.data?.data);
  const serviceRequest = requests.find((request) => request.id === srId);
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された病理検査は別の患者のものです。</p>
      ) : serviceRequest ? (
        <PathoOrderDetailPanel
          serviceRequest={serviceRequest}
          itemRequests={pathoOrderItemRequests(requests, srId)}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="病理検査" />
      )}
    </>
  );
}

function PathoResultDetail({ patientId, reportId }: { patientId: string; reportId: string }) {
  const detail = usePathoResultDetail(reportId);
  const report = detail.data ? splitPathoResultDetailBundle(detail.data.data).report : undefined;
  const mismatch = isPatientMismatch(patientId, report?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された病理レポートは別の患者のものです。</p>
      ) : report ? (
        <PathoResultDetailPanel reportId={reportId} />
      ) : (
        !detail.error && <NotFound label="病理レポート" />
      )}
    </>
  );
}

function MicroResultDetail({ patientId, reportId }: { patientId: string; reportId: string }) {
  const detail = useMicroResultDetail(reportId);
  const report = detail.data ? splitMicroResultDetailBundle(detail.data.data).report : undefined;
  const mismatch = isPatientMismatch(patientId, report?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された細菌検査結果は別の患者のものです。</p>
      ) : report ? (
        <MicroResultDetailPanel reportId={reportId} />
      ) : (
        !detail.error && <NotFound label="細菌検査結果" />
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
      ) : item.kind === "lab-order" ? (
        <LabOrderJson srId={item.id} />
      ) : item.kind === "micro-order" ? (
        <MicroOrderJson srId={item.id} />
      ) : item.kind === "rad-order" ? (
        <RadOrderJson srId={item.id} />
      ) : item.kind === "physio-order" ? (
        <PhysioOrderJson srId={item.id} />
      ) : item.kind === "endoscopy-order" ? (
        <EndoscopyOrderJson srId={item.id} />
      ) : item.kind === "treatment-order" ? (
        <TreatmentOrderJson srId={item.id} />
      ) : item.kind === "surgery-order" ? (
        <SurgeryOrderJson srId={item.id} />
      ) : item.kind === "meal-order" ? (
        <MealOrderJson srId={item.id} />
      ) : item.kind === "patho-order" ? (
        <PathoOrderJson srId={item.id} />
      ) : item.kind === "transfusion-order" ? (
        <TransfusionOrderJson srId={item.id} />
      ) : item.kind === "rehab-order" ? (
        <RehabOrderJson srId={item.id} />
      ) : (
        <FhirJsonView resource={jsonResource(item)} />
      )}
    </Modal>
  );
}

// オーダー系以外でモーダルにそのまま出すリソース。バイタルは 1 回の測定が項目ごとの
// Observation に分かれるので、束ねたものを collection Bundle にして全項目を見せる。
function jsonResource(item: KarteTimelineItem): fhir4.Resource {
  if (item.kind === "note") return item.note;
  if (item.kind === "vital") {
    const bundle: fhir4.Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: item.entry.observations.map((observation) => ({ resource: observation })),
    };
    return bundle;
  }
  if (item.kind === "qr") return item.response;
  return item.serviceRequest;
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

// 検体検査もオーダーのヘッダと明細をまとめた Bundle で見せる。
function LabOrderJson({ srId }: { srId: string }) {
  const detail = useLabOrderDetail(srId);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? <p>読み込み中...</p> : <FhirJsonView resource={detail.data?.data} />}
    </>
  );
}

// 細菌検査もオーダーのヘッダと明細をまとめた Bundle で見せる。
function MicroOrderJson({ srId }: { srId: string }) {
  const detail = useMicroOrderDetail(srId);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? <p>読み込み中...</p> : <FhirJsonView resource={detail.data?.data} />}
    </>
  );
}

// 放射線検査もオーダーのヘッダと明細をまとめた Bundle で見せる。実施入力があるときは、
// 実施記録(Procedure 一式)がオーダーとは別リソースなので、別の見出しで続けて出す
// (1 つの Bundle に混ぜると、依頼した内容と実際に行ったことの境目が読めなくなる)。
function RadOrderJson({ srId }: { srId: string }) {
  const detail = useRadOrderDetail(srId);
  const perform = useRadPerformDetail(srId);
  const performBundle = perform.data?.data;
  const hasPerform = (performBundle?.entry?.length ?? 0) > 0;

  return (
    <>
      <ErrorBanner error={detail.error} />
      <ErrorBanner error={perform.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : hasPerform ? (
        <>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">オーダー</h3>
            <FhirJsonView resource={detail.data?.data} />
          </section>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">実施記録</h3>
            <FhirJsonView resource={performBundle} />
          </section>
        </>
      ) : (
        <FhirJsonView resource={detail.data?.data} />
      )}
    </>
  );
}

function PhysioOrderJson({ srId }: { srId: string }) {
  const detail = usePhysioOrderDetail(srId);
  const perform = usePhysioPerformDetail(srId);
  const performBundle = perform.data?.data;
  const hasPerform = (performBundle?.entry?.length ?? 0) > 0;

  return (
    <>
      <ErrorBanner error={detail.error} />
      <ErrorBanner error={perform.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : hasPerform ? (
        <>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">オーダー</h3>
            <FhirJsonView resource={detail.data?.data} />
          </section>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">実施記録</h3>
            <FhirJsonView resource={performBundle} />
          </section>
        </>
      ) : (
        <FhirJsonView resource={detail.data?.data} />
      )}
    </>
  );
}

function TreatmentOrderJson({ srId }: { srId: string }) {
  const detail = useTreatmentOrderDetail(srId);
  const perform = useTreatmentPerformDetail(srId);
  const performBundle = perform.data?.data;
  const hasPerform = (performBundle?.entry?.length ?? 0) > 0;

  return (
    <>
      <ErrorBanner error={detail.error} />
      <ErrorBanner error={perform.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : hasPerform ? (
        <>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">オーダー</h3>
            <FhirJsonView resource={detail.data?.data} />
          </section>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">実施記録</h3>
            <FhirJsonView resource={performBundle} />
          </section>
        </>
      ) : (
        <FhirJsonView resource={detail.data?.data} />
      )}
    </>
  );
}

// 食事オーダーは実施記録を持たないので、オーダーの ServiceRequest 1 本だけを出す。
// 輸血のカードから開く内容表示。製剤明細もヘッダと一緒に取れるので、病理と同じ形。
function TransfusionOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useTransfusionOrderDetail(srId);
  const requests = serviceRequestsOf(detail.data?.data);
  const serviceRequest = requests.find((request) => request.id === srId);
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された輸血オーダーは別の患者のものです。</p>
      ) : serviceRequest ? (
        <TransfusionOrderDetailPanel
          serviceRequest={serviceRequest}
          itemRequests={transfusionOrderItemRequests(requests, srId)}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="輸血オーダー" />
      )}
    </>
  );
}

// 病理・輸血もオーダーのヘッダと明細をまとめた Bundle で見せる(検体検査と同じ)。
function PathoOrderJson({ srId }: { srId: string }) {
  const detail = usePathoOrderDetail(srId);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? <p>読み込み中...</p> : <FhirJsonView resource={detail.data?.data} />}
    </>
  );
}

// 輸血は手術と同じく実施記録が別リソースなので、あればオーダーと並べて出す。
function TransfusionOrderJson({ srId }: { srId: string }) {
  const detail = useTransfusionOrderDetail(srId);
  const perform = useTransfusionPerformDetail(srId);
  const performBundle = perform.data?.data;
  const hasPerform = (performBundle?.entry?.length ?? 0) > 0;

  return (
    <>
      <ErrorBanner error={detail.error} />
      <ErrorBanner error={perform.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : hasPerform ? (
        <>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">オーダー</h3>
            <FhirJsonView resource={detail.data?.data} />
          </section>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">実施記録</h3>
            <FhirJsonView resource={performBundle} />
          </section>
        </>
      ) : (
        <FhirJsonView resource={detail.data?.data} />
      )}
    </>
  );
}

// リハビリはオーダーの検索に進捗 Task と実施 Procedure を _revinclude で添えてある
// ので、他部門のように実施記録を別に引かなくてよい。
function RehabOrderJson({ srId }: { srId: string }) {
  const detail = useRehabOrderDetail(srId);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? <p>読み込み中...</p> : <FhirJsonView resource={detail.data?.data} />}
    </>
  );
}

function MealOrderJson({ srId }: { srId: string }) {
  const detail = useMealOrderDetail(srId);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? <p>読み込み中...</p> : <FhirJsonView resource={detail.data?.data} />}
    </>
  );
}

function SurgeryOrderJson({ srId }: { srId: string }) {
  const detail = useSurgeryOrderDetail(srId);
  const perform = useSurgeryPerformDetail(srId);
  const performBundle = perform.data?.data;
  const hasPerform = (performBundle?.entry?.length ?? 0) > 0;

  return (
    <>
      <ErrorBanner error={detail.error} />
      <ErrorBanner error={perform.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : hasPerform ? (
        <>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">オーダー</h3>
            <FhirJsonView resource={detail.data?.data} />
          </section>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">実施記録</h3>
            <FhirJsonView resource={performBundle} />
          </section>
        </>
      ) : (
        <FhirJsonView resource={detail.data?.data} />
      )}
    </>
  );
}

function EndoscopyOrderJson({ srId }: { srId: string }) {
  const detail = useEndoscopyOrderDetail(srId);
  const perform = useEndoscopyPerformDetail(srId);
  const performBundle = perform.data?.data;
  const hasPerform = (performBundle?.entry?.length ?? 0) > 0;

  return (
    <>
      <ErrorBanner error={detail.error} />
      <ErrorBanner error={perform.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : hasPerform ? (
        <>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">オーダー</h3>
            <FhirJsonView resource={detail.data?.data} />
          </section>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">実施記録</h3>
            <FhirJsonView resource={performBundle} />
          </section>
        </>
      ) : (
        <FhirJsonView resource={detail.data?.data} />
      )}
    </>
  );
}
