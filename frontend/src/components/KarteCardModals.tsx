import type { ComponentType, ReactNode } from "react";
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
  useRadiotherapyOrderDetail,
  useRadiotherapyCourseReviews,
  useTreatmentAdverseEvents,
  useRehabOrderDetail,
  useNutritionGuidanceOrderDetail,
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
import { PhysioOrderDetailPanel } from "./PhysioOrderDetailPanel";
import { EndoscopyOrderDetailPanel } from "./EndoscopyOrderDetailPanel";
import { TreatmentOrderDetailPanel } from "./TreatmentOrderDetailPanel";
import { SurgeryOrderDetailPanel } from "./SurgeryOrderDetailPanel";
import { TransfusionOrderDetailPanel } from "./TransfusionOrderDetailPanel";
import { RehabOrderDetailPanel } from "./RehabOrderDetailPanel";
import { NutritionGuidanceOrderDetailPanel } from "./NutritionGuidanceOrderDetailPanel";
import { ConsultOrderDetailPanel } from "./ConsultOrderDetailPanel";
import { RadiotherapyOrderDetailPanel } from "./RadiotherapyOrderDetailPanel";
import { useRadiotherapyOrderInitialValues } from "../hooks/useRadiotherapyOrderInitialValues";
import { rehabPerformsByOrderId } from "../fhir/rehabResultHelpers";
import { nutritionGuidancePerformsByOrderId } from "../fhir/nutritionGuidanceResultHelpers";
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
  "consult-order": ConsultOrderDetail,
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
  onClose,
}: {
  patientId: string;
  target: KarteDetailTarget;
  problemsById: Map<string, fhir4.Condition>;
  /** 詳細の下に並べる操作(編集・実施入力 など)。渡さなければ読むだけのモーダル。 */
  actions?: ReactNode;
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
        <InjectionDetailPanel
          serviceRequest={serviceRequest}
          medicationRequests={medicationRequests}
          task={tasks.find(isInjectionTask)}
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
        <PathoResultDetailPanel reportId={reportId} />
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
      title={`FHIR JSON(${karteItemKindLabel(item)})`}
      onClose={onClose}
      className="modal--wide"
    >
      {item.kind === "prescription" || item.kind === "injection" ? (
        <PrescriptionJson srId={item.id} />
      ) : isOrderKind(item.kind) ? (
        <OrderJson kind={item.kind} srId={item.id} />
      ) : (
        <FhirJsonView resource={jsonResource(item)} />
      )}
    </Modal>
  );
}

// 放射線・生理検査・内視鏡は同じ形(オーダー + 実施記録)なので、設定と hook を渡して共用する。
function RadOrderJson({ srId }: { srId: string }) {
  return (
    <ExamOrderJson
      config={EXAM_REPORT_CONFIGS.rad}
      useOrderDetail={useRadOrderDetail}
      usePerformDetail={useRadPerformDetail}
      srId={srId}
    />
  );
}

function PhysioOrderJson({ srId }: { srId: string }) {
  return (
    <ExamOrderJson
      config={EXAM_REPORT_CONFIGS.physio}
      useOrderDetail={usePhysioOrderDetail}
      usePerformDetail={usePhysioPerformDetail}
      srId={srId}
    />
  );
}

function EndoscopyOrderJson({ srId }: { srId: string }) {
  return (
    <ExamOrderJson
      config={EXAM_REPORT_CONFIGS.endoscopy}
      useOrderDetail={useEndoscopyOrderDetail}
      usePerformDetail={useEndoscopyPerformDetail}
      srId={srId}
    />
  );
}

// 部門オーダーの FHIR JSON。ヘッダと明細・実施記録をまとめて見せる。
const ORDER_JSONS: Record<OrderKind, ComponentType<{ srId: string }>> = {
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
  "consult-order": ConsultOrderJson,
};

function OrderJson({ kind, srId }: { kind: OrderKind; srId: string }) {
  const Json = ORDER_JSONS[kind];
  return <Json srId={srId} />;
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
  if (item.kind === "pathway-evaluation") return item.evaluation.observation;
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

function LabOrderJson({ srId }: { srId: string }) {
  const detail = useLabOrderDetail(srId);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? <p>読み込み中...</p> : <FhirJsonView resource={detail.data?.data} />}
    </>
  );
}

function MicroOrderJson({ srId }: { srId: string }) {
  const detail = useMicroOrderDetail(srId);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? <p>読み込み中...</p> : <FhirJsonView resource={detail.data?.data} />}
    </>
  );
}

// 放射線検査・生理検査・内視鏡もオーダーのヘッダと明細をまとめた Bundle で見せる。実施記録
// (Procedure 一式)とレポートはオーダーとは別リソースなので、あるときは別の見出しで続けて出す
// (1 つの Bundle に混ぜると、依頼した内容・実際に行ったこと・読んだ結果の境目が読めなくなる)。
function ExamOrderJson({
  config,
  useOrderDetail,
  usePerformDetail,
  srId,
}: {
  config: ExamReportConfig;
  useOrderDetail: typeof useRadOrderDetail;
  usePerformDetail: typeof useRadPerformDetail;
  srId: string;
}) {
  const detail = useOrderDetail(srId);
  const perform = usePerformDetail(srId);
  const report = useExamReportByOrder(config, srId);
  const performBundle = perform.data?.data;
  const reportBundle = report.data?.data;
  const hasPerform = (performBundle?.entry?.length ?? 0) > 0;
  const hasReport = (reportBundle?.entry?.length ?? 0) > 0;

  return (
    <>
      <ErrorBanner error={detail.error} />
      <ErrorBanner error={perform.error ?? report.error} />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : hasPerform || hasReport ? (
        <>
          <section className="karte-json__section">
            <h3 className="karte-json__section-title">オーダー</h3>
            <FhirJsonView resource={detail.data?.data} />
          </section>
          {hasPerform && (
            <section className="karte-json__section">
              <h3 className="karte-json__section-title">実施記録</h3>
              <FhirJsonView resource={performBundle} />
            </section>
          )}
          {hasReport && (
            <section className="karte-json__section">
              <h3 className="karte-json__section-title">{config.labels.report}</h3>
              <FhirJsonView resource={reportBundle} />
            </section>
          )}
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

function RadiotherapyOrderJson({ srId }: { srId: string }) {
  const detail = useRadiotherapyOrderDetail(srId);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? <p>読み込み中...</p> : <FhirJsonView resource={detail.data?.data} />}
    </>
  );
}

function ConsultOrderJson({ srId }: { srId: string }) {
  const detail = useConsultOrderDetail(srId);

  return (
    <>
      <ErrorBanner error={detail.error} />
      {detail.isLoading ? <p>読み込み中...</p> : <FhirJsonView resource={detail.data?.data} />}
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

// 栄養指導もリハビリと同じく進捗 Task と実施 Procedure が _revinclude で届く。
function NutritionGuidanceOrderJson({ srId }: { srId: string }) {
  const detail = useNutritionGuidanceOrderDetail(srId);

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

