import type { ComponentType } from "react";
import {
  useBroughtMedWorklist,
  useEndoscopyWorklist,
  useInjectionWorklist,
  useLabWorklist,
  useMedicationGuidanceWorklist,
  useNutritionGuidanceWorklist,
  usePathoWorklist,
  usePhysioWorklist,
  useRadWorklist,
  useRadiotherapyWorklist,
  useRehabWorklist,
  useRxVerificationQueue,
  useRxWorklist,
  useSurgeryUnscheduledList,
  useSurgeryWorklist,
  useTransfusionWorklist,
  useTreatmentWorklist,
} from "../../api/queries";
import { BROUGHT_MED_REVIEW_STATUS_OPTIONS } from "../../fhir/broughtMedTaskHelpers";
import { ENDOSCOPY_TASK_STATUS_OPTIONS, endoscopyTaskStatus } from "../../fhir/endoscopyTaskHelpers";
import { HOME_WORKLISTS, type HomeWorklistKey } from "../../fhir/homeSections";
import { INJECTION_TASK_STATUS_OPTIONS, injectionTaskStatus } from "../../fhir/injectionTaskHelpers";
import { LAB_TASK_STATUS_OPTIONS, labTaskStatus } from "../../fhir/labTaskHelpers";
import {
  MEDICATION_GUIDANCE_TASK_STATUS_OPTIONS,
  medicationGuidanceAssignee,
  medicationGuidanceTaskStatus,
} from "../../fhir/medicationGuidanceTaskHelpers";
import {
  NUTRITION_GUIDANCE_TASK_STATUS_OPTIONS,
  nutritionGuidanceTaskStatus,
} from "../../fhir/nutritionGuidanceTaskHelpers";
import { PATHO_TASK_STATUS_OPTIONS, pathoTaskStatus } from "../../fhir/pathoTaskHelpers";
import { PHYSIO_TASK_STATUS_OPTIONS, physioTaskStatus } from "../../fhir/physioTaskHelpers";
import { RAD_TASK_STATUS_OPTIONS, radTaskStatus } from "../../fhir/radTaskHelpers";
import {
  RADIOTHERAPY_TASK_STATUS_OPTIONS,
  radiotherapyTaskStatus,
} from "../../fhir/radiotherapyTaskHelpers";
import { REHAB_TASK_STATUS_OPTIONS, rehabTaskStatus } from "../../fhir/rehabTaskHelpers";
import { RX_TASK_STATUS_OPTIONS, rxTaskStatus } from "../../fhir/rxTaskHelpers";
import { SURGERY_TASK_STATUS_OPTIONS, surgeryTaskStatus } from "../../fhir/surgeryTaskHelpers";
import {
  TRANSFUSION_TASK_STATUS_OPTIONS,
  transfusionTaskStatus,
} from "../../fhir/transfusionTaskHelpers";
import { TREATMENT_TASK_STATUS_OPTIONS, treatmentTaskStatus } from "../../fhir/treatmentTaskHelpers";
import { HomeCountsCard, type HomeCountsCardProps } from "./HomeCountsCard";
import type { HomeCardProps } from "./shared";
import { useOpenAntimicrobialNotifications } from "../../api/queries";
import {
  ANTIMICROBIAL_NOTIFICATION_STATE_LABEL,
  antimicrobialNotificationState,
} from "../../fhir/antimicrobialNotificationHelpers";

// ホームの「自部門のワークリスト件数」。部門ごとに一覧の hook をそのまま呼び、Task の
// 状態を数える(一覧ページと同じキャッシュに乗るので、カードから一覧へ移っても読み直さない)。
// hook は条件付きで呼べないので、部門ごとに別のコンポーネントにして親が kind で出し分ける。

type WorklistCountsProps = Omit<HomeCountsCardProps, "title" | "path"> & { kind: HomeWorklistKey };

function WorklistCounts({ kind, ...rest }: WorklistCountsProps) {
  const def = HOME_WORKLISTS[kind];
  return <HomeCountsCard title={def.label} path={def.path} {...rest} />;
}

interface DateProps {
  date: string;
}

function LabCard({ date }: DateProps) {
  const query = useLabWorklist(date);
  return (
    <WorklistCounts
      kind="lab"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => labTaskStatus(row.task))}
      options={LAB_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
    />
  );
}

function PhysioCard({ date }: DateProps) {
  const query = usePhysioWorklist(date);
  return (
    <WorklistCounts
      kind="physio"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => physioTaskStatus(row.task))}
      options={PHYSIO_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
    />
  );
}

function PathoCard({ date }: DateProps) {
  const query = usePathoWorklist(date);
  return (
    <WorklistCounts
      kind="patho"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => pathoTaskStatus(row.task))}
      options={PATHO_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
    />
  );
}

function TransfusionCard({ date }: DateProps) {
  const query = useTransfusionWorklist(date);
  return (
    <WorklistCounts
      kind="transfusion"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => transfusionTaskStatus(row.task))}
      options={TRANSFUSION_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
    />
  );
}

function RadCard({ date }: DateProps) {
  const query = useRadWorklist(date);
  return (
    <WorklistCounts
      kind="rad"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => radTaskStatus(row.task))}
      options={RAD_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
    />
  );
}

/** 放射線治療は日付ではなく「進行中のコース」を数える。 */
function RadiotherapyCard() {
  const query = useRadiotherapyWorklist("open");
  return (
    <WorklistCounts
      kind="radiotherapy"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => radiotherapyTaskStatus(row.task))}
      options={RADIOTHERAPY_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
    />
  );
}

function RxCard({ date }: DateProps) {
  const query = useRxWorklist(date);
  return (
    <WorklistCounts
      kind="rx"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => rxTaskStatus(row.task))}
      options={RX_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
    />
  );
}

function InjectionCard({ date }: DateProps) {
  const query = useInjectionWorklist(date);
  return (
    <WorklistCounts
      kind="injection"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => injectionTaskStatus(row.task))}
      options={INJECTION_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
    />
  );
}

const RX_VERIFICATION_STATUS_OPTIONS = [{ code: "requested", display: "未監査" }];

/** 処方監査も日付を持たない(未監査が全部)。至急の件数を添える。 */
function RxVerificationCard({ date }: DateProps) {
  const query = useRxVerificationQueue("pending", { from: date, to: date });
  const urgent = query.data?.tasks.filter((task) => task.priority && task.priority !== "routine").length;
  return (
    <WorklistCounts
      kind="rxVerification"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.tasks.map((task) => task.status)}
      options={RX_VERIFICATION_STATUS_OPTIONS}
      truncated={query.data?.truncated}
      extra={urgent !== undefined ? [{ label: "至急", count: urgent }] : undefined}
    />
  );
}

/** 持参薬鑑別は日付を持たない(未鑑別の依頼が全部)。 */
function BroughtMedCard() {
  const query = useBroughtMedWorklist({});
  return (
    <WorklistCounts
      kind="broughtMed"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.map((item) => item.task.status)}
      options={BROUGHT_MED_REVIEW_STATUS_OPTIONS}
    />
  );
}

/** リハビリは期間オーダーなので、当日に効いている件数と、うち当日まだ実施していない件数を出す。 */
function RehabCard({ date }: DateProps) {
  const query = useRehabWorklist(date);
  const notPerformed = query.data?.rows.filter(
    (row) => rehabTaskStatus(row.task) === "accepted" && row.todayPerforms.length === 0,
  ).length;
  return (
    <WorklistCounts
      kind="rehab"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => rehabTaskStatus(row.task))}
      options={REHAB_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
      extra={notPerformed !== undefined ? [{ label: "本日未実施", count: notPerformed }] : undefined}
    />
  );
}

function NutritionGuidanceCard({ date }: DateProps) {
  const query = useNutritionGuidanceWorklist(date);
  const notPerformed = query.data?.rows.filter(
    (row) => nutritionGuidanceTaskStatus(row.task) === "accepted" && row.todayPerforms.length === 0,
  ).length;
  return (
    <WorklistCounts
      kind="nutritionGuidance"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => nutritionGuidanceTaskStatus(row.task))}
      options={NUTRITION_GUIDANCE_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
      extra={notPerformed !== undefined ? [{ label: "本日未実施", count: notPerformed }] : undefined}
    />
  );
}

/** 服薬指導も期間オーダーなので、当日に効いている件数と、うち担当が決まっていない件数を出す。 */
function MedicationGuidanceCard({ date }: DateProps) {
  const query = useMedicationGuidanceWorklist(date);
  const unassigned = query.data?.rows.filter(
    (row) => medicationGuidanceTaskStatus(row.task) !== "cancelled" && !medicationGuidanceAssignee(row.task),
  ).length;
  return (
    <WorklistCounts
      kind="medicationGuidance"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => medicationGuidanceTaskStatus(row.task))}
      options={MEDICATION_GUIDANCE_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
      extra={unassigned !== undefined ? [{ label: "担当未定", count: unassigned }] : undefined}
    />
  );
}

/** 未対応の特定抗菌薬の届出(届出未提出・許可待ち)。日付に依らず院内全体。 */
function AntimicrobialCard() {
  const query = useOpenAntimicrobialNotifications();
  return (
    <WorklistCounts
      kind="antimicrobial"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.tasks.map((task) => antimicrobialNotificationState(task))}
      options={Object.entries(ANTIMICROBIAL_NOTIFICATION_STATE_LABEL)
        .filter(([code]) => code !== "completed")
        .map(([code, display]) => ({ code, display }))}
      truncated={query.data?.truncated}
    />
  );
}

function EndoscopyCard({ date }: DateProps) {
  const query = useEndoscopyWorklist(date);
  return (
    <WorklistCounts
      kind="endoscopy"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => endoscopyTaskStatus(row.task))}
      options={ENDOSCOPY_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
    />
  );
}

function TreatmentCard({ date }: DateProps) {
  const query = useTreatmentWorklist(date);
  return (
    <WorklistCounts
      kind="treatment"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => treatmentTaskStatus(row.task))}
      options={TREATMENT_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
    />
  );
}

/** 手術は当日の件数に、日程が決まっていない申込の件数を添える。 */
function SurgeryCard({ date }: DateProps) {
  const query = useSurgeryWorklist(date);
  const unscheduled = useSurgeryUnscheduledList();
  return (
    <WorklistCounts
      kind="surgery"
      isPending={query.isPending}
      error={query.error ?? unscheduled.error}
      statuses={query.data?.rows.map((row) => surgeryTaskStatus(row.task))}
      options={SURGERY_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
      extra={unscheduled.data ? [{ label: "日程未定", count: unscheduled.data.rows.length }] : undefined}
    />
  );
}

const WORKLIST_CARDS: Record<HomeWorklistKey, ComponentType<DateProps>> = {
  lab: LabCard,
  physio: PhysioCard,
  patho: PathoCard,
  transfusion: TransfusionCard,
  rad: RadCard,
  radiotherapy: RadiotherapyCard,
  rxVerification: RxVerificationCard,
  rx: RxCard,
  injection: InjectionCard,
  broughtMed: BroughtMedCard,
  medicationGuidance: MedicationGuidanceCard,
  antimicrobial: AntimicrobialCard,
  rehab: RehabCard,
  nutritionGuidance: NutritionGuidanceCard,
  endoscopy: EndoscopyCard,
  treatment: TreatmentCard,
  surgery: SurgeryCard,
};

export function HomeWorklistCard({ card, date }: HomeCardProps<"worklist">) {
  const Card = WORKLIST_CARDS[card.settings.worklist];
  return <Card date={date} />;
}
