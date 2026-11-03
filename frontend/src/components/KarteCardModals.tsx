import { useMemo, type ComponentType, type ReactNode } from "react";
import {
  useClinicalNote,
  useLabOrderDetail,
  useMicroOrderDetail,
  usePathoOrderDetail,
  usePathoResultDetail,
  useExamReportDetail,
  useMicroResultDetail,
  useRadOrderDetail,
  useRadPerformDetail,
  useExamReportByOrder,
  usePhysioOrderDetail,
  usePhysioPerformDetail,
  useEndoscopyOrderDetail,
  useEndoscopyPerformDetail,
  useMealOrderDetail,
  useConsultOrderDetail,
  useTeamRequestDetail,
  useRadiotherapyOrderDetail,
  useRadiotherapyCourseReviews,
  useTreatmentAdverseEvents,
  useRehabOrderDetail,
  useNutritionGuidanceOrderDetail,
  useMedicalManagementOrderDetail,
  useMedicationGuidanceOrderDetail,
  useTransfusionOrderDetail,
  useTransfusionPerformDetail,
  useTreatmentOrderDetail,
  useSurgeryOrderDetail,
  useSurgeryPerformDetail,
  useTreatmentPerformDetail,
  useLabResultDetail,
  usePrescriptionDetail,
  useQuestionnaireResponseWithQuestionnaire,
  useKarteCardResources,
} from "../api/queries";
import { karteItemKindLabel, type KarteTimelineItem } from "../fhir/karteTimeline";
import { isOrderKind, ORDER_KIND_LABELS, ORDER_KINDS, type OrderKind } from "../fhir/orderKinds";
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
import {
  EXAM_REPORT_CONFIGS,
  splitExamReportBundle,
  type ExamReportConfig,
} from "../fhir/examReportHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { splitPrescriptionDetailBundle } from "../fhir/prescriptionHelpers";
import type { KarteDetailKind, KarteDetailTarget } from "../karteUrl";
import { ClinicalNoteDetailPanel } from "./ClinicalNoteDetailPanel";
import { ErrorBanner } from "./ErrorBanner";
import { FhirJsonView } from "./FhirJsonView";
import { InjectionDetailPanel } from "./InjectionDetailPanel";
import { isInjectionTask } from "../fhir/injectionTaskHelpers";
import { LabOrderDetailPanel } from "./LabOrderDetailPanel";
import { LabResultDetailPanel } from "./LabResultDetailPanel";
import { RxInquirySection } from "./RxInquirySection";
import { RxVerificationSection } from "./RxVerificationModal";
import { Modal } from "./Modal";
import { MicroOrderDetailPanel } from "./MicroOrderDetailPanel";
import { MicroResultDetailPanel } from "./MicroResultDetailPanel";
import { PathoOrderDetailPanel } from "./PathoOrderDetailPanel";
import { PathoResultDetailPanel } from "./PathoResultDetailPanel";
import { PrescriptionDetailPanel } from "./PrescriptionDetailPanel";
import { QuestionnaireResponseDetailPanel } from "./QuestionnaireResponseDetailPanel";
import { RadOrderDetailPanel } from "./RadOrderDetailPanel";
import { ExamReportDetailPanel } from "./ExamReportDetailPanel";
import { ResultReviewAction } from "./ResultReviewAction";
import { ResultExplanationAction } from "./ResultExplanationAction";
import { PhysioOrderDetailPanel } from "./PhysioOrderDetailPanel";
import { EndoscopyOrderDetailPanel } from "./EndoscopyOrderDetailPanel";
import { TreatmentOrderDetailPanel } from "./TreatmentOrderDetailPanel";
import { SurgeryOrderDetailPanel } from "./SurgeryOrderDetailPanel";
import { TransfusionOrderDetailPanel } from "./TransfusionOrderDetailPanel";
import { transfusionDispensesByOrderId } from "../fhir/transfusionDispenseHelpers";
import { splitPerformBundle } from "../fhir/radResultHelpers";
import { RehabOrderDetailPanel } from "./RehabOrderDetailPanel";
import { NutritionGuidanceOrderDetailPanel } from "./NutritionGuidanceOrderDetailPanel";
import { MedicalManagementOrderDetailPanel } from "./MedicalManagementOrderDetailPanel";
import { medicalManagementItemsByOrderId } from "../fhir/medicalManagementOrderHelpers";
import { ConsultOrderDetailPanel } from "./ConsultOrderDetailPanel";
import { TeamRequestDetailPanel } from "./TeamRequestDetailPanel";
import { teamRequestTasksByOrderId } from "../fhir/teamRequestTaskHelpers";
import { RadiotherapyOrderDetailPanel } from "./RadiotherapyOrderDetailPanel";
import { useRadiotherapyOrderInitialValues } from "../hooks/useRadiotherapyOrderInitialValues";
import { rehabPerformsByOrderId } from "../fhir/rehabResultHelpers";
import { nutritionGuidancePerformsByOrderId } from "../fhir/nutritionGuidanceResultHelpers";
import { MedicationGuidanceOrderDetailPanel } from "./MedicationGuidanceOrderDetailPanel";
import { medicationGuidancePerformsByOrderId } from "../fhir/medicationGuidanceResultHelpers";
import { resourcesOfType } from "../fhir/shared";

// カルテのタイムラインから開くモーダル。詳細表示は各リソースの詳細ページと同じ
// パネルを使うので、カードでは省いている情報(処方の DI リンクなど)も参照できる。

const DETAIL_TITLES: Record<KarteDetailKind, string> = {
  note: "診療記録詳細",
  prescription: "処方内容",
  injection: "注射内容",
  ...(Object.fromEntries(ORDER_KINDS.map((kind) => [kind, `${ORDER_KIND_LABELS[kind]}内容`])) as Record<
    OrderKind,
    string
  >),
  "lab-result": "検査結果内容",
  "micro-result": "細菌検査結果内容",
  "patho-result": "病理診断レポート",
  "rad-result": EXAM_REPORT_CONFIGS.rad.labels.report,
  "physio-result": EXAM_REPORT_CONFIGS.physio.labels.report,
  "endoscopy-result": EXAM_REPORT_CONFIGS.endoscopy.labels.report,
  qr: "テンプレート表示",
};

interface OrderDetailProps {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}

// 部門オーダーの内容表示。種別を足したら 1 行足す(足し忘れは型エラーになる)。
const ORDER_DETAILS: Record<OrderKind, ComponentType<OrderDetailProps>> = {
  "lab-order": LabOrderDetail,
  "micro-order": MicroOrderDetail,
  "patho-order": PathoOrderDetail,
  "rad-order": RadOrderDetail,
  "physio-order": PhysioOrderDetail,
  "endoscopy-order": EndoscopyOrderDetail,
  "treatment-order": TreatmentOrderDetail,
  "surgery-order": SurgeryOrderDetail,
  "meal-order": MealOrderDetail,
  "transfusion-order": TransfusionOrderDetail,
  "rehab-order": RehabOrderDetail,
  "radiotherapy-order": RadiotherapyOrderDetail,
  "nutrition-guidance-order": NutritionGuidanceOrderDetail,
  "medical-management-order": MedicalManagementOrderDetail,
  "medication-guidance-order": MedicationGuidanceOrderDetail,
  "consult-order": ConsultOrderDetail,
  "team-request": TeamRequestDetail,
};

function OrderDetail({ kind, ...props }: OrderDetailProps & { kind: OrderKind }) {
  const Detail = ORDER_DETAILS[kind];
  return <Detail {...props} />;
}

// 対象は URL から来るので、タイムラインに読み込み済みかどうかに関わらず
// ID から引き直す。別患者の ID を指す URL は内容を出さない。
export function KarteDetailModal({
  patientId,
  target,
  problemsById,
  actions,
  onEditOrder,
  onClose,
}: {
  patientId: string;
  target: KarteDetailTarget;
  problemsById: Map<string, fhir4.Condition>;
  /** 詳細の下に並べる操作(編集・実施入力 など)。渡さなければ読むだけのモーダル。 */
  actions?: ReactNode;
  /** 疑義照会に「処方を変更する」と回答した後に、そのオーダーの編集を開く。 */
  onEditOrder?: (kind: "prescription" | "injection", srId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={DETAIL_TITLES[target.kind]} onClose={onClose} className="modal--wide">
      {target.kind === "note" ? (
        <NoteDetail patientId={patientId} noteId={target.id} />
      ) : target.kind === "prescription" ? (
        <PrescriptionDetail
          patientId={patientId}
          srId={target.id}
          problemsById={problemsById}
          onEditOrder={onEditOrder && (() => onEditOrder("prescription", target.id))}
        />
      ) : target.kind === "injection" ? (
        <InjectionDetail
          patientId={patientId}
          srId={target.id}
          problemsById={problemsById}
          onEditOrder={onEditOrder && (() => onEditOrder("injection", target.id))}
        />
      ) : isOrderKind(target.kind) ? (
        <OrderDetail kind={target.kind} patientId={patientId} srId={target.id} problemsById={problemsById} />
      ) : target.kind === "lab-result" ? (
        <LabResultDetail patientId={patientId} reportId={target.id} />
      ) : target.kind === "micro-result" ? (
        <MicroResultDetail patientId={patientId} reportId={target.id} />
      ) : target.kind === "patho-result" ? (
        <PathoResultDetail patientId={patientId} reportId={target.id} />
      ) : target.kind === "rad-result" ? (
        <ExamResultDetail config={EXAM_REPORT_CONFIGS.rad} patientId={patientId} reportId={target.id} />
      ) : target.kind === "physio-result" ? (
        <ExamResultDetail
          config={EXAM_REPORT_CONFIGS.physio}
          patientId={patientId}
          reportId={target.id}
        />
      ) : target.kind === "endoscopy-result" ? (
        <ExamResultDetail
          config={EXAM_REPORT_CONFIGS.endoscopy}
          patientId={patientId}
          reportId={target.id}
        />
      ) : (
        <QuestionnaireResponseDetail patientId={patientId} qrId={target.id} />
      )}
      {actions && <div className="lab-order-item__actions karte-detail__actions">{actions}</div>}
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
  onEditOrder,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
  onEditOrder?: () => void;
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
        <>
          <PrescriptionDetailPanel
            serviceRequest={serviceRequest}
            medicationRequests={medicationRequests}
            problemsById={problemsById}
          />
          <RxInquirySection kind="prescription" order={serviceRequest} onEditOrder={onEditOrder} />
          <RxVerificationSection order={serviceRequest} />
        </>
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
  onEditOrder,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
  onEditOrder?: () => void;
}) {
  const detail = usePrescriptionDetail(srId);
  const { serviceRequest, medicationRequests, tasks } = detail.data
    ? splitPrescriptionDetailBundle(detail.data.data)
    : { serviceRequest: undefined, medicationRequests: [], tasks: [] };
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された注射は別の患者のものです。</p>
      ) : serviceRequest ? (
        <>
          <InjectionDetailPanel
            serviceRequest={serviceRequest}
            medicationRequests={medicationRequests}
            task={tasks.find(isInjectionTask)}
            problemsById={problemsById}
          />
          <RxInquirySection kind="injection" order={serviceRequest} onEditOrder={onEditOrder} />
          <RxVerificationSection order={serviceRequest} />
        </>
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

  const procedures = resourcesOfType<fhir4.Procedure>(detail.data?.data, "Procedure");
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

// 栄養指導もリハビリと同じく、実施記録がオーダーの検索に _revinclude で添えてある
// (useNutritionGuidanceOrderDetail)。実施履歴を全件並べたいので同じ応答から取り出す。
function NutritionGuidanceOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useNutritionGuidanceOrderDetail(srId);
  const serviceRequest = serviceRequestsOf(detail.data?.data).find(
    (request) => request.id === srId,
  );
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  const procedures = resourcesOfType<fhir4.Procedure>(detail.data?.data, "Procedure");
  const performs = nutritionGuidancePerformsByOrderId(procedures).get(srId) ?? [];

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された栄養指導オーダーは別の患者のものです。</p>
      ) : serviceRequest ? (
        <NutritionGuidanceOrderDetailPanel
          serviceRequest={serviceRequest}
          performs={performs}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="栄養指導オーダー" />
      )}
    </>
  );
}

// 指導・管理料も実施記録(算定項目)がオーダーの検索に _revinclude で添えてある。
function MedicalManagementOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useMedicalManagementOrderDetail(srId);
  const serviceRequest = serviceRequestsOf(detail.data?.data).find((request) => request.id === srId);
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);
  const procedures = resourcesOfType<fhir4.Procedure>(detail.data?.data, "Procedure");
  const items = medicalManagementItemsByOrderId(procedures).get(srId) ?? [];

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された指導・管理料オーダーは別の患者のものです。</p>
      ) : serviceRequest ? (
        <MedicalManagementOrderDetailPanel serviceRequest={serviceRequest} items={items} problemsById={problemsById} />
      ) : (
        !detail.error && <NotFound label="指導・管理料オーダー" />
      )}
    </>
  );
}

// 服薬指導も栄養指導と同じく、実施記録がオーダーの検索に _revinclude で添えてある。
function MedicationGuidanceOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useMedicationGuidanceOrderDetail(srId);
  const serviceRequest = serviceRequestsOf(detail.data?.data).find((request) => request.id === srId);
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);
  const procedures = resourcesOfType<fhir4.Procedure>(detail.data?.data, "Procedure");
  const performs = medicationGuidancePerformsByOrderId(procedures).get(srId) ?? [];

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された服薬指導オーダーは別の患者のものです。</p>
      ) : serviceRequest ? (
        <MedicationGuidanceOrderDetailPanel
          serviceRequest={serviceRequest}
          performs={performs}
          problemsById={problemsById}
        />
      ) : (
        !detail.error && <NotFound label="服薬指導オーダー" />
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
        <>
          <div className="karte-tabpanel__actions exam-report-detail__review">
            <div className="result-review-group">
              <ResultReviewAction reportId={reportId} />
              <ResultExplanationAction reportId={reportId} />
            </div>
          </div>
          <PathoResultDetailPanel reportId={reportId} />
        </>
      ) : (
        !detail.error && <NotFound label="病理レポート" />
      )}
    </>
  );
}

// 検査レポート(読影・生理検査・内視鏡の所見)。カルテにタブが無いので、依頼医の確認(既読)はここで行う。
function ExamResultDetail({
  config,
  patientId,
  reportId,
}: {
  config: ExamReportConfig;
  patientId: string;
  reportId: string;
}) {
  const detail = useExamReportDetail(reportId);
  const { report } = splitExamReportBundle(config, detail.data?.data);
  const mismatch = isPatientMismatch(patientId, report?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">{`指定された${config.labels.report}は別の患者のものです。`}</p>
      ) : report ? (
        <>
          <div className="karte-tabpanel__actions exam-report-detail__review">
            <ResultReviewAction reportId={reportId} />
          </div>
          <ExamReportDetailPanel config={config} reportId={reportId} />
        </>
      ) : (
        !detail.error && <NotFound label={config.labels.report} />
      )}
    </>
  );
}

// 細菌検査のカードから開く「検査結果表示」。中身は細菌検査タブの内容表示と同じ
// パネルで、患者の取り違えだけここで弾く(パネルと同じクエリなので追加の取得は無い)。
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
  // 自己血の採血予定はヘッダと一緒に届く。
  const appointments = resourcesOfType<fhir4.Appointment>(detail.data?.data, "Appointment");
  // 出庫記録(ハブとバッグ)は実施記録と同じ検索で届く。
  const perform = useTransfusionPerformDetail(srId);
  const dispenses = useMemo(() => {
    const { procedures, dispenses: bags } = splitPerformBundle(perform.data?.data);
    return transfusionDispensesByOrderId(procedures, bags).get(srId) ?? [];
  }, [perform.data, srId]);

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
          dispenses={dispenses}
          appointments={appointments}
        />
      ) : (
        !detail.error && <NotFound label="輸血オーダー" />
      )}
    </>
  );
}

// 他科依頼は明細も実施記録も持たないので、ヘッダ 1 件だけを見る。
// 回答(診療記録)はここには出さず、カードの「回答表示」から診療記録として開く。
function ConsultOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useConsultOrderDetail(srId);
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
        <p className="patient-table__empty">指定された他科依頼は別の患者のものです。</p>
      ) : serviceRequest ? (
        <ConsultOrderDetailPanel serviceRequest={serviceRequest} problemsById={problemsById} />
      ) : (
        !detail.error && <NotFound label="他科依頼" />
      )}
    </>
  );
}

// 放射線治療も明細を持たないヘッダ 1 件。進捗は同じ検索に _revinclude で届く。
function RadiotherapyOrderDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const { serviceRequest, taskStatus, fractions, courseSummary, ready, patientMismatch, error } =
    useRadiotherapyOrderInitialValues(srId, patientId, true);
  // 有害事象と診察(週次レビュー)はコースに紐づくので治療処方の id で引く(§6.3)。
  const adverseEvents = useTreatmentAdverseEvents(srId);
  const reviews = useRadiotherapyCourseReviews(srId);

  return (
    <>
      {!patientMismatch && <ErrorBanner error={error} />}
      {!ready ? (
        <p>読み込み中...</p>
      ) : patientMismatch ? (
        <p className="patient-table__empty">指定された放射線治療は別の患者のものです。</p>
      ) : serviceRequest ? (
        <RadiotherapyOrderDetailPanel
          serviceRequest={serviceRequest}
          taskStatus={taskStatus}
          fractions={fractions}
          courseSummary={courseSummary}
          adverseEvents={adverseEvents.data}
          reviews={reviews.data}
          problemsById={problemsById}
        />
      ) : (
        !error && <NotFound label="放射線治療" />
      )}
    </>
  );
}

// チーム依頼も明細を持たないヘッダ 1 件。進捗は同じ検索に _revinclude で届く。
function TeamRequestDetail({
  patientId,
  srId,
  problemsById,
}: {
  patientId: string;
  srId: string;
  problemsById: Map<string, fhir4.Condition>;
}) {
  const detail = useTeamRequestDetail(srId);
  const serviceRequest = serviceRequestsOf(detail.data?.data).find((request) => request.id === srId);
  const task = teamRequestTasksByOrderId(resourcesOfType<fhir4.Task>(detail.data?.data, "Task")).get(srId);
  const mismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定されたチーム依頼は別の患者のものです。</p>
      ) : serviceRequest ? (
        <TeamRequestDetailPanel serviceRequest={serviceRequest} task={task} problemsById={problemsById} />
      ) : (
        !detail.error && <NotFound label="チーム依頼" />
      )}
    </>
  );
}

// カードの FHIRリソース表示。カードの記録を引き直し、記録を指す来歴(Provenance)と Task も
// 同じ Bundle に添えてもらう(DetailSearchOptions の audit)。
export function KarteCardJsonModal({
  item,
  onClose,
}: {
  item: KarteTimelineItem;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`FHIRリソース(${karteItemKindLabel(item)})`}
      onClose={onClose}
      className="modal--wide"
    >
      {item.kind === "prescription" || item.kind === "injection" ? (
        <PrescriptionJson srId={item.id} />
      ) : isOrderKind(item.kind) ? (
        <OrderJson kind={item.kind} srId={item.id} />
      ) : (
        <RecordJson {...recordRef(item)} />
      )}
    </Modal>
  );
}

const AUDIT = { audit: true };

interface JsonSection {
  title: string;
  resource: fhir4.Resource | undefined;
  /** 中身の無い Bundle なら節ごと出さない(まだ無いことがある実施記録・レポート)。 */
  optional?: boolean;
}

/** 詳細の検索 1 本(useXxxDetail の結果)。 */
interface BundleQuery {
  data?: { data: fhir4.Bundle };
  isLoading: boolean;
  error: unknown;
}

function isEmptyBundle(resource: fhir4.Resource): boolean {
  return resource.resourceType === "Bundle" && !(resource as fhir4.Bundle).entry?.length;
}

function KarteJsonSections({
  sections,
  loading,
  errors,
}: {
  sections: JsonSection[];
  loading: boolean;
  errors: unknown[];
}) {
  const shown = sections.filter(
    (section): section is JsonSection & { resource: fhir4.Resource } =>
      section.resource !== undefined && !(section.optional && isEmptyBundle(section.resource)),
  );

  return (
    <>
      {errors.map((error, index) => (
        <ErrorBanner key={index} error={error} />
      ))}
      {loading ? (
        <p>読み込み中...</p>
      ) : shown.length === 1 ? (
        <FhirJsonView resource={shown[0].resource} />
      ) : (
        shown.map((section) => (
          <section key={section.title} className="karte-json__section">
            <h3 className="karte-json__section-title">{section.title}</h3>
            <FhirJsonView resource={section.resource} />
          </section>
        ))
      )}
    </>
  );
}

// オーダーのヘッダと明細は 1 つの Bundle で見せる。実施記録(Procedure 一式)とレポートは
// オーダーとは別リソースなので、あるときは別の見出しで続けて出す(1 つの Bundle に混ぜると、
// 依頼した内容・実際に行ったこと・読んだ結果の境目が読めなくなる)。
function OrderBundleJson({
  order,
  perform,
  report,
}: {
  order: BundleQuery;
  perform?: BundleQuery;
  report?: { title: string; query: BundleQuery };
}) {
  return (
    <KarteJsonSections
      loading={order.isLoading || Boolean(perform?.isLoading) || Boolean(report?.query.isLoading)}
      errors={[order.error, perform?.error, report?.query.error]}
      sections={[
        { title: "オーダー", resource: order.data?.data },
        { title: "実施記録", resource: perform?.data?.data, optional: true },
        { title: report?.title ?? "レポート", resource: report?.query.data?.data, optional: true },
      ]}
    />
  );
}

// オーダー系以外のカードの記録。バイタルは 1 回の測定が項目ごとの Observation に分かれるので、
// 束ねた全項目を引く。
function recordRef(item: KarteTimelineItem): { type: fhir4.FhirResource["resourceType"]; ids: string[] } {
  const ids = (resources: fhir4.Resource[]) => resources.flatMap((resource) => (resource.id ? [resource.id] : []));
  if (item.kind === "note") return { type: "Composition", ids: ids([item.note]) };
  if (item.kind === "vital") return { type: "Observation", ids: ids(item.entry.observations) };
  if (item.kind === "qr") return { type: "QuestionnaireResponse", ids: ids([item.response]) };
  if (item.kind === "pathway-evaluation") return { type: "Observation", ids: ids([item.evaluation.observation]) };
  if (item.kind === "adverse-event") return { type: "Observation", ids: ids([item.record.observation]) };
  return { type: "ServiceRequest", ids: ids([item.serviceRequest]) };
}

function RecordJson({ type, ids }: { type: fhir4.FhirResource["resourceType"]; ids: string[] }) {
  const query = useKarteCardResources(type, ids);
  return (
    <KarteJsonSections
      loading={query.isLoading}
      errors={[query.error]}
      sections={[{ title: "記録", resource: query.data?.data }]}
    />
  );
}

type SrIdProps = { srId: string };

// 処方・注射は ServiceRequest と MedicationRequest をまとめた Bundle(処方内容ページと同じ検索)。
function PrescriptionJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={usePrescriptionDetail(srId, AUDIT)} />;
}

// 放射線・生理検査・内視鏡は同じ形(オーダー + 実施記録 + レポート)。
function ExamOrderJson({
  config,
  order,
  perform,
  srId,
}: {
  config: ExamReportConfig;
  order: BundleQuery;
  perform: BundleQuery;
  srId: string;
}) {
  const report = useExamReportByOrder(config, srId, AUDIT);
  return <OrderBundleJson order={order} perform={perform} report={{ title: config.labels.report, query: report }} />;
}

function RadOrderJson({ srId }: SrIdProps) {
  return (
    <ExamOrderJson
      config={EXAM_REPORT_CONFIGS.rad}
      order={useRadOrderDetail(srId, AUDIT)}
      perform={useRadPerformDetail(srId, AUDIT)}
      srId={srId}
    />
  );
}

function PhysioOrderJson({ srId }: SrIdProps) {
  return (
    <ExamOrderJson
      config={EXAM_REPORT_CONFIGS.physio}
      order={usePhysioOrderDetail(srId, AUDIT)}
      perform={usePhysioPerformDetail(srId, AUDIT)}
      srId={srId}
    />
  );
}

function EndoscopyOrderJson({ srId }: SrIdProps) {
  return (
    <ExamOrderJson
      config={EXAM_REPORT_CONFIGS.endoscopy}
      order={useEndoscopyOrderDetail(srId, AUDIT)}
      perform={useEndoscopyPerformDetail(srId, AUDIT)}
      srId={srId}
    />
  );
}

// 処置・手術・輸血は実施記録が別リソースなので、あればオーダーと並べて出す。
function TreatmentOrderJson({ srId }: SrIdProps) {
  return (
    <OrderBundleJson order={useTreatmentOrderDetail(srId, AUDIT)} perform={useTreatmentPerformDetail(srId, AUDIT)} />
  );
}

function SurgeryOrderJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={useSurgeryOrderDetail(srId, AUDIT)} perform={useSurgeryPerformDetail(srId, AUDIT)} />;
}

function TransfusionOrderJson({ srId }: SrIdProps) {
  return (
    <OrderBundleJson
      order={useTransfusionOrderDetail(srId, AUDIT)}
      perform={useTransfusionPerformDetail(srId, AUDIT)}
    />
  );
}

function LabOrderJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={useLabOrderDetail(srId, AUDIT)} />;
}

function MicroOrderJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={useMicroOrderDetail(srId, AUDIT)} />;
}

function PathoOrderJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={usePathoOrderDetail(srId, AUDIT)} />;
}

function MealOrderJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={useMealOrderDetail(srId, AUDIT)} />;
}

// リハビリ・栄養指導・放射線治療・チーム依頼は、進捗 Task(と実施 Procedure)がオーダーの
// 検索に _revinclude で届くので、実施記録を別に引かなくてよい。
function RehabOrderJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={useRehabOrderDetail(srId, AUDIT)} />;
}

function NutritionGuidanceOrderJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={useNutritionGuidanceOrderDetail(srId, AUDIT)} />;
}

function RadiotherapyOrderJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={useRadiotherapyOrderDetail(srId, AUDIT)} />;
}

function TeamRequestJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={useTeamRequestDetail(srId, AUDIT)} />;
}

function MedicalManagementOrderJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={useMedicalManagementOrderDetail(srId, AUDIT)} />;
}

function MedicationGuidanceOrderJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={useMedicationGuidanceOrderDetail(srId, AUDIT)} />;
}

function ConsultOrderJson({ srId }: SrIdProps) {
  return <OrderBundleJson order={useConsultOrderDetail(srId, AUDIT)} />;
}

const ORDER_JSONS: Record<OrderKind, ComponentType<SrIdProps>> = {
  "lab-order": LabOrderJson,
  "micro-order": MicroOrderJson,
  "patho-order": PathoOrderJson,
  "rad-order": RadOrderJson,
  "physio-order": PhysioOrderJson,
  "endoscopy-order": EndoscopyOrderJson,
  "treatment-order": TreatmentOrderJson,
  "surgery-order": SurgeryOrderJson,
  "meal-order": MealOrderJson,
  "transfusion-order": TransfusionOrderJson,
  "rehab-order": RehabOrderJson,
  "radiotherapy-order": RadiotherapyOrderJson,
  "nutrition-guidance-order": NutritionGuidanceOrderJson,
  "medical-management-order": MedicalManagementOrderJson,
  "medication-guidance-order": MedicationGuidanceOrderJson,
  "consult-order": ConsultOrderJson,
  "team-request": TeamRequestJson,
};

function OrderJson({ kind, srId }: { kind: OrderKind } & SrIdProps) {
  const Json = ORDER_JSONS[kind];
  return <Json srId={srId} />;
}
