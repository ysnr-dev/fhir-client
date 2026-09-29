import { useMemo, type ComponentType } from "react";
import { Link } from "react-router-dom";
import {
  useBroughtMedWorklist,
  useInjectionWorklist,
  useLabWorklist,
  useNutritionGuidanceWorklist,
  usePathoWorklist,
  usePhysioWorklist,
  useRadWorklist,
  useRadiotherapyWorklist,
  useRehabWorklist,
  useRxWorklist,
  useTransfusionWorklist,
} from "../api/queries";
import { BROUGHT_MED_REVIEW_STATUS_OPTIONS } from "../fhir/broughtMedTaskHelpers";
import { HOME_WORKLISTS, summarizeTaskStatuses, type HomeWorklistKey } from "../fhir/homeSections";
import { INJECTION_TASK_STATUS_OPTIONS, injectionTaskStatus } from "../fhir/injectionTaskHelpers";
import { LAB_TASK_STATUS_OPTIONS, labTaskStatus } from "../fhir/labTaskHelpers";
import {
  NUTRITION_GUIDANCE_TASK_STATUS_OPTIONS,
  nutritionGuidanceTaskStatus,
} from "../fhir/nutritionGuidanceTaskHelpers";
import { PATHO_TASK_STATUS_OPTIONS, pathoTaskStatus } from "../fhir/pathoTaskHelpers";
import { PHYSIO_TASK_STATUS_OPTIONS, physioTaskStatus } from "../fhir/physioTaskHelpers";
import { RAD_TASK_STATUS_OPTIONS, radTaskStatus } from "../fhir/radTaskHelpers";
import {
  RADIOTHERAPY_TASK_STATUS_OPTIONS,
  radiotherapyTaskStatus,
} from "../fhir/radiotherapyTaskHelpers";
import { REHAB_TASK_STATUS_OPTIONS, rehabTaskStatus } from "../fhir/rehabTaskHelpers";
import { RX_TASK_STATUS_OPTIONS, rxTaskStatus } from "../fhir/rxTaskHelpers";
import {
  TRANSFUSION_TASK_STATUS_OPTIONS,
  transfusionTaskStatus,
} from "../fhir/transfusionTaskHelpers";
import { ErrorBanner } from "./ErrorBanner";

// ホームの「自部門のワークリスト件数」。部門ごとに一覧の hook をそのまま呼び、Task の
// 状態を数える(一覧ページと同じキャッシュに乗るので、カードから一覧へ移っても読み直さない)。
// hook は条件付きで呼べないので、部門ごとに別のコンポーネントにして親が kind で出し分ける。

interface WorklistCountsProps {
  kind: HomeWorklistKey;
  isPending: boolean;
  error: unknown;
  /** 行ごとの Task の状態(Task 無しは requested)。読み込み前は undefined。 */
  statuses: string[] | undefined;
  /** 状態コード → 表示名。部門ごとの語彙(受付済 / 実施中 / 出庫済 …)で出す。 */
  options: { code: string; display: string }[];
  truncated?: boolean;
  /** 部門固有の補足(リハビリの「本日未実施」など)。 */
  extra?: { label: string; count: number }[];
}

function WorklistCounts({
  kind,
  isPending,
  error,
  statuses,
  options,
  truncated,
  extra,
}: WorklistCountsProps) {
  const def = HOME_WORKLISTS[kind];
  const summary = useMemo(() => summarizeTaskStatuses(statuses ?? []), [statuses]);
  return (
    <section className="home__card">
      <div className="home__card-header">
        <h2>{def.label}</h2>
        <Link to={def.path}>一覧</Link>
      </div>
      <ErrorBanner error={error} />
      {isPending ? (
        <p className="home__empty">読み込み中...</p>
      ) : (
        <>
          <p className="home__counts">
            <span className="home__count home__count--big">
              未処理 <strong>{summary.open}</strong>
            </span>
          </p>
          <p className="home__counts">
            {options
              .filter((option) => (summary.byStatus.get(option.code) ?? 0) > 0)
              .map((option) => (
                <span key={option.code} className="home__count">
                  {option.display} <strong>{summary.byStatus.get(option.code)}</strong>
                </span>
              ))}
            {extra?.map((item) => (
              <span key={item.label} className="home__count">
                {item.label} <strong>{item.count}</strong>
              </span>
            ))}
          </p>
          {truncated && (
            <p className="error-banner__line error-banner__line--warning" role="status">
              件数が多いため、一部のみ数えています。
            </p>
          )}
        </>
      )}
    </section>
  );
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

const WORKLIST_CARDS: Record<HomeWorklistKey, ComponentType<DateProps>> = {
  lab: LabCard,
  physio: PhysioCard,
  patho: PathoCard,
  transfusion: TransfusionCard,
  rad: RadCard,
  radiotherapy: RadiotherapyCard,
  rx: RxCard,
  injection: InjectionCard,
  broughtMed: BroughtMedCard,
  rehab: RehabCard,
  nutritionGuidance: NutritionGuidanceCard,
};

export function HomeWorklistCard({ kind, date }: { kind: HomeWorklistKey; date: string }) {
  const Card = WORKLIST_CARDS[kind];
  return <Card date={date} />;
}
