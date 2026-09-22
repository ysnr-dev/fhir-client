import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { radiotherapyDeviceHooks, radiotherapyStopReasonHooks } from "../api/masterQueries";
import {
  useCancelRadiotherapyFraction,
  useDeleteRadiotherapyPlanned,
  useRescheduleRadiotherapyFraction,
  useRestoreRadiotherapyFraction,
  useRadiotherapyCourseFractions,
  useRadiotherapyProcedures,
  useRadiotherapyWorklist,
  useUpdateRadiotherapyTaskStatus,
  type RadiotherapyCalendarEntry,
  type RadiotherapyWorklistRow,
  type RadiotherapyWorklistView,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { PatientKana } from "../components/PatientRowCells";
import {
  RadiotherapyCalendar,
  type CoursePanelDrag,
  type RadiotherapyCalendarMode,
  type RadiotherapySlot,
} from "../components/RadiotherapyCalendar";
import { RadiotherapyCourseSummaryModal } from "../components/RadiotherapyCourseSummaryModal";
import { RadiotherapyOrderDetailPanel } from "../components/RadiotherapyOrderDetailPanel";
import { RadiotherapyOrderCreateModal } from "../components/RadiotherapyOrderModals";
import { RadiotherapyPerformModal } from "../components/RadiotherapyPerformModal";
import {
  RadiotherapyFractionCancelModal,
  RadiotherapyPlanModal,
  RadiotherapyRescheduleModal,
} from "../components/RadiotherapyPlanModal";
import {
  RadiotherapySlotModal,
  planOptionsFromSlot,
} from "../components/RadiotherapySlotModal";
import { RowMenu } from "../components/RowMenu";
import { displayName } from "../fhir/patientHelpers";
import {
  summarizeRadiotherapyOrder,
  type RadiotherapyOrderSummary,
} from "../fhir/radiotherapyOrderHelpers";
import {
  radiotherapyPlanEligibility,
  radiotherapyProgress,
  type RadiotherapyFractionDisplay,
  type RadiotherapyPlanOptions,
} from "../fhir/radiotherapyResultHelpers";
import {
  RADIOTHERAPY_TASK_STATUS_OPTIONS,
  radiotherapyTaskActions,
  radiotherapyTaskStatus,
  radiotherapyTaskStatusDisplay,
  type RadiotherapyTaskAction,
  type RadiotherapyTaskStatus,
} from "../fhir/radiotherapyTaskHelpers";
import { today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 放射線治療カレンダー(部門の画面。docs/radiotherapy-order-design.md §7)。
//
// 左が**治療装置 × 時刻**の格子(日)/ 治療装置 × 日(週)で、照射の予定と実績が並ぶ。
// 右が治療コースの一覧で、受付・治療開始・**照射予定の一括登録**・休止・終了・サマリーは
// ここから行う。手術カレンダーと同じ「格子 + 右のパネル」の構成。
//
// 日々の流れ: コースを受け付ける → 照射予定を組む(コースのカードを格子へ落とす / 空き枠を
// 掴んでコースを選ぶ / カードの「予定登録」) → 当日は格子の予定の「実施」を押し、入っている
// 値を確かめて登録する。治療処方そのものはカルテで放射線治療医が書くのが本筋だが、部門で
// 受けて代わりに起こせるよう「新規登録」からも作れる(中身はカルテ右ペインと同じフォーム)。
//
// 進捗の変更は Task と ServiceRequest.status を同じ transaction で書く(§4)。

interface Target {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
}

interface Terminating {
  row: RadiotherapyWorklistRow;
  action: RadiotherapyTaskAction;
}

const EMPTY_FRACTIONS: RadiotherapyFractionDisplay[] = [];

export function RadiotherapyWorklistPage() {
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<RadiotherapyCalendarMode>("day");
  const [view, setView] = useState<RadiotherapyWorklistView>("open");

  // 開いている対象は行そのものではなく id で覚えておき、読み直しのたびに引き直す。
  // カレンダーの照射は、右の一覧が別のタブ(終了・中止)でも開けるよう、オーダーごと持つ。
  const [viewing, setViewing] = useState<Target | null>(null);
  // 照射予定の一括登録。格子の枠から来たとき(空き枠・コースのドロップ)は、その枠を初期値にする。
  const [planning, setPlanning] = useState<
    (Target & { initialOptions?: Partial<RadiotherapyPlanOptions> }) | null
  >(null);
  // 掴んだ空き枠。どのコースの照射を入れるかを選ぶ。
  const [slot, setSlot] = useState<RadiotherapySlot | null>(null);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [terminating, setTerminating] = useState<Terminating | null>(null);
  // 実施入力。格子の予定から開いたときはその予定を、コースから開いたときは次の回を入れる。
  const [performing, setPerforming] = useState<(Target & { plannedId?: string }) | null>(null);
  const [rescheduling, setRescheduling] = useState<RadiotherapyCalendarEntry | null>(null);
  // 1 回の中止(照射しなかった回として残す)。
  const [cancellingFraction, setCancellingFraction] = useState<RadiotherapyCalendarEntry | null>(null);
  // 治療処方の新規登録(患者を選んでから中身を書く)。
  const [creatingOrder, setCreatingOrder] = useState(false);

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useRadiotherapyWorklist(view);
  const updateStatus = useUpdateRadiotherapyTaskStatus();
  const cancelFraction = useCancelRadiotherapyFraction();
  const deletePlanned = useDeleteRadiotherapyPlanned();
  const reschedule = useRescheduleRadiotherapyFraction();
  const restoreFraction = useRestoreRadiotherapyFraction();
  // 空き枠に入れられるコースは進行中のものだけなので、右のパネルのタブとは別に持つ。
  const openCourses = useRadiotherapyWorklist("open");

  // 照射記録は**右のパネルに出ているコースだけ**引く(§8)。格子のカードは期間で切った
  // `useRadiotherapyCalendar` の結果だけで描けるので、ここには足さない —— 足すと日付を
  // 動かすたびに id が変わり、照射記録を引き直すことになる。格子から開くモーダルが要る
  // ぶんは、そのコースだけを下の `useRadiotherapyCourseFractions` で引く。
  // 両方が決着してから引くのは、先に返ったぶんだけで一度引いてしまわないため。
  const sourcesSettled = !worklist.isPending && !openCourses.isPending;
  const courseIds = useMemo(
    () =>
      sourcesSettled
        ? [
            ...(worklist.data?.rows ?? []).map((row) => row.order.id ?? ""),
            ...(openCourses.data?.rows ?? []).map((row) => row.order.id ?? ""),
          ]
        : [],
    [sourcesSettled, worklist.data, openCourses.data],
  );
  const procedures = useRadiotherapyProcedures(courseIds);
  // 回数・累積線量・装置の絞り込みは照射記録が要る。届くまでは伏せる(0 回と見せない)。
  const fractionsReady = procedures.data !== undefined;

  const rows = useMemo(() => worklist.data?.rows ?? [], [worklist.data]);
  const rowOf = (orderId: string | null | undefined) => rows.find((row) => row.order.id === orderId);
  const fractionsOf = (orderId: string | undefined) =>
    procedures.data?.fractions.get(orderId ?? "") ?? EMPTY_FRACTIONS;
  const summaryOf = (orderId: string | undefined) => procedures.data?.summaries.get(orderId ?? "");

  const summarizing = rowOf(summarizingId);

  // 入力するモーダルは**開いた時点の照射記録で初期値が決まる**(実施入力の何回目、一括登録の
  // 残り、サマリーの集計)。一覧の写しは古いことがあるので、開く対象のコースだけを引き直し、
  // 届いてから出す。詳細の表示は初期値を持たないので待たずに開く(届けば入れ替わる)。
  const formOrderId = planning?.order.id ?? performing?.order.id ?? summarizing?.order.id;
  const activeOrderId = formOrderId ?? viewing?.order.id;
  const courseFractions = useRadiotherapyCourseFractions(activeOrderId);
  const courseFractionsOf = (orderId: string | undefined) =>
    orderId && orderId === activeOrderId && courseFractions.data
      ? courseFractions.data
      : fractionsOf(orderId);
  const waitingCourse = Boolean(formOrderId) && courseFractions.isPending;
  // 待っているあいだの枠。開こうとしているモーダルと同じ見出しにする(カルテから照射入力を
  // 開くときと同じ形)。
  const waitingTarget = planning ?? performing ?? summarizing;
  const waitingTitle = `${
    planning ? "照射予定の一括登録" : performing ? "照射入力" : "治療終了サマリー"
  }${waitingTarget?.patient ? ` - ${displayName(waitingTarget.patient)}` : ""}`;
  const formFractionsReady = Boolean(formOrderId) && courseFractions.data !== undefined;

  function closeCourseForms() {
    setPlanning(null);
    setPerforming(null);
    setSummarizingId(null);
  }

  function handleAction(row: RadiotherapyWorklistRow, action: RadiotherapyTaskAction) {
    if (action.asksTermination) return setTerminating({ row, action });
    updateStatus.mutate({ order: row.order, task: row.task, status: action.next });
  }

  /** 進行中のコース。空き枠のモーダルが、予定を足せるもの・足せないもの(理由つき)に分けて出す。 */
  const slotCourses = useMemo(
    () =>
      (openCourses.data?.rows ?? []).map((row) => ({ row, fractions: fractionsOf(row.order.id) })),
    // fractionsOf は procedures.data から引くだけなので、依存はそちらで足りる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openCourses.data, procedures.data],
  );

  function openPlan(row: RadiotherapyWorklistRow, from?: RadiotherapySlot) {
    setSlot(null);
    setPlanning({
      order: row.order,
      patient: row.patient,
      ...(from ? { initialOptions: planOptionsFromSlot(from) } : {}),
    });
  }

  function handleDeletePlanned(ids: string[]) {
    if (ids.length > 0) deletePlanned.mutate(ids);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>放射線治療カレンダー</h1>
        {/* 治療処方はカルテで放射線治療医が書くのが本筋だが、部門で受けて代わりに
            起こす場面があるので、ここからも登録できるようにする。 */}
        <button type="button" onClick={() => setCreatingOrder(true)}>
          新規登録
        </button>
      </div>

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={procedures.error} />
      <ErrorBanner error={courseFractions.error} />
      <ErrorBanner error={updateStatus.error} />
      <ErrorBanner error={cancelFraction.error} />
      <ErrorBanner error={deletePlanned.error} />
      <ErrorBanner error={reschedule.error} />
      <ErrorBanner error={restoreFraction.error} />

      <RadiotherapyCalendar
        date={date}
        onDateChange={setDate}
        mode={mode}
        onModeChange={setMode}
        onPerform={(entry) => {
          if (entry.order) {
            setPerforming({ order: entry.order, patient: entry.patient, plannedId: entry.fraction.id });
          }
        }}
        onReschedule={setRescheduling}
        onDeletePlanned={(entry) => handleDeletePlanned([entry.fraction.id])}
        onCancelFraction={setCancellingFraction}
        onRestoreFraction={(entry) => restoreFraction.mutate(entry.fraction.id)}
        onView={(entry) => {
          if (entry.order) setViewing({ order: entry.order, patient: entry.patient });
        }}
        onEmptySlot={setSlot}
        onCourseDrop={(row, target) => openPlan(row, target)}
        onMove={(entry, change) => reschedule.mutate({ procedureId: entry.fraction.id, ...change })}
        panel={(drag) => (
          <CoursePanel
            drag={drag}
            view={view}
            onViewChange={setView}
            rows={rows}
            loading={worklist.isLoading}
            truncated={Boolean(worklist.data?.truncated)}
            fractionsOf={fractionsOf}
            fractionsReady={fractionsReady}
            hasSummary={(orderId) => Boolean(summaryOf(orderId))}
            pending={updateStatus.isPending || deletePlanned.isPending}
            onView={(row) => setViewing({ order: row.order, patient: row.patient })}
            onPlan={(row) => openPlan(row)}
            onPerform={(row) => setPerforming({ order: row.order, patient: row.patient })}
            onSummarize={(row) => setSummarizingId(row.order.id ?? null)}
            onAction={handleAction}
            onClearPlanned={(row) =>
              handleDeletePlanned(
                fractionsOf(row.order.id)
                  .filter((fraction) => fraction.planned)
                  .map((fraction) => fraction.id),
              )
            }
          />
        )}
      />

      {viewing && (
        <Modal
          title={`放射線治療内容 - ${viewing.patient ? displayName(viewing.patient) : ""}`}
          onClose={() => setViewing(null)}
          className="modal--wide"
        >
          <RadiotherapyOrderDetailPanel
            serviceRequest={rowOf(viewing.order.id)?.order ?? viewing.order}
            taskStatus={
              rowOf(viewing.order.id)
                ? radiotherapyTaskStatus(rowOf(viewing.order.id)?.task)
                : undefined
            }
            fractions={courseFractionsOf(viewing.order.id)}
            courseSummary={summaryOf(viewing.order.id)}
            onCancelFraction={(fractionId) => cancelFraction.mutate(fractionId)}
            cancellingFractionId={cancelFraction.isPending ? cancelFraction.variables : undefined}
          />
        </Modal>
      )}

      {slot && (
        <RadiotherapySlotModal
          slot={slot}
          courses={slotCourses}
          onPlan={(row) => openPlan(row, slot)}
          onClose={() => setSlot(null)}
        />
      )}

      {planning && formFractionsReady && (
        <RadiotherapyPlanModal
          order={planning.order}
          fractions={courseFractionsOf(planning.order.id)}
          patientName={planning.patient ? displayName(planning.patient) : undefined}
          initialOptions={planning.initialOptions}
          onClose={() => setPlanning(null)}
        />
      )}

      {performing && formFractionsReady && (
        <RadiotherapyPerformModal
          order={performing.order}
          fractions={courseFractionsOf(performing.order.id)}
          plannedId={performing.plannedId}
          patientName={performing.patient ? displayName(performing.patient) : undefined}
          onClose={() => setPerforming(null)}
        />
      )}

      {cancellingFraction && (
        <RadiotherapyFractionCancelModal
          fraction={cancellingFraction.fraction}
          patientName={
            cancellingFraction.patient ? displayName(cancellingFraction.patient) : undefined
          }
          onClose={() => setCancellingFraction(null)}
        />
      )}

      {rescheduling && (
        <RadiotherapyRescheduleModal
          fraction={rescheduling.fraction}
          patientName={rescheduling.patient ? displayName(rescheduling.patient) : undefined}
          onClose={() => setRescheduling(null)}
        />
      )}

      {summarizing && formFractionsReady && (
        <RadiotherapyCourseSummaryModal
          order={summarizing.order}
          fractions={courseFractionsOf(summarizing.order.id)}
          existing={summaryOf(summarizing.order.id)}
          patientName={summarizing.patient ? displayName(summarizing.patient) : undefined}
          onClose={() => setSummarizingId(null)}
        />
      )}

      {waitingCourse && (
        <Modal title={waitingTitle} onClose={closeCourseForms}>
          <p>読み込み中...</p>
        </Modal>
      )}

      {terminating && (
        <TerminationModal terminating={terminating} onClose={() => setTerminating(null)} />
      )}

      {creatingOrder && <RadiotherapyOrderCreateModal onClose={() => setCreatingOrder(false)} />}
    </div>
  );
}

// 右のパネル。治療コースの一覧(進行中 / 終了・中止)。
function CoursePanel({
  drag,
  view,
  onViewChange,
  rows,
  loading,
  truncated,
  fractionsOf,
  fractionsReady,
  hasSummary,
  pending,
  onView,
  onPlan,
  onPerform,
  onSummarize,
  onAction,
  onClearPlanned,
}: {
  drag: CoursePanelDrag;
  view: RadiotherapyWorklistView;
  onViewChange: (view: RadiotherapyWorklistView) => void;
  rows: RadiotherapyWorklistRow[];
  loading: boolean;
  truncated: boolean;
  fractionsOf: (orderId: string | undefined) => RadiotherapyFractionDisplay[];
  /** 照射記録が届いているか。届くまで回数は伏せ、装置の絞り込みは効かせない。 */
  fractionsReady: boolean;
  hasSummary: (orderId: string | undefined) => boolean;
  pending: boolean;
  onView: (row: RadiotherapyWorklistRow) => void;
  onPlan: (row: RadiotherapyWorklistRow) => void;
  onPerform: (row: RadiotherapyWorklistRow) => void;
  onSummarize: (row: RadiotherapyWorklistRow) => void;
  onAction: (row: RadiotherapyWorklistRow, action: RadiotherapyTaskAction) => void;
  onClearPlanned: (row: RadiotherapyWorklistRow) => void;
}) {
  const devices = radiotherapyDeviceHooks.useOptions();
  const [filters, setFilters] = useState<CourseFilters>(EMPTY_COURSE_FILTERS);

  // 絞り込みは読んだ行に対して画面側で行う(部門一覧の他の画面と同じ。件数は有限)。
  const shown = useMemo(
    () =>
      rows.filter((row) =>
        matchesCourseFilters(row, fractionsOf(row.order.id), filters, fractionsReady),
      ),
    // fractionsOf は procedures のキャッシュを引くだけなので、依存は rows と絞り込みで足りる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filters, fractionsReady],
  );
  const filtered = shown.length !== rows.length;

  function update(patch: Partial<CourseFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  return (
    <aside className="surgery-pending">
      <div className="surgery-pending__head">
        <span className="surgery-pending__title">治療コース</span>
        <span className="surgery-pending__count">
          {filtered ? `${shown.length} / ${rows.length} 件` : `${rows.length} 件`}
        </span>
      </div>
      <div className="order-select__tabs" role="tablist">
        {(
          [
            ["open", "進行中"],
            ["closed", "終了・中止"],
          ] as const
        ).map(([code, label]) => (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={view === code}
            className={view === code ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => onViewChange(code)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* コースは数十件並ぶので絞り込みを置く。装置は「その装置で照射する予定のコース」で、
          予定の装置(実績を含む)か、まだ予定が無ければ Phase の使用予定装置で見る。 */}
      <div className="radiotherapy-courses__filters">
        <label>
          装置
          <select value={filters.deviceCode} onChange={(e) => update({ deviceCode: e.target.value })}>
            <option value="">すべて</option>
            {devices.items.map((device) => (
              <option key={device.code} value={device.code}>
                {device.name}
              </option>
            ))}
            <option value={NO_DEVICE_FILTER}>装置未定</option>
          </select>
        </label>
        <label>
          進捗
          <select value={filters.status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">すべて</option>
            {RADIOTHERAPY_TASK_STATUS_OPTIONS.filter((option) =>
              view === "open"
                ? option.code !== "completed" && option.code !== "cancelled"
                : option.code === "completed" || option.code === "cancelled",
            ).map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label className="radiotherapy-courses__filter-wide">
          患者
          <input
            type="search"
            value={filters.patient}
            placeholder="氏名・患者番号"
            onChange={(e) => update({ patient: e.target.value })}
          />
        </label>
      </div>

      {truncated && (
        <p className="order-select__muted" role="status">
          コースが多いため、一部のみ表示しています。
        </p>
      )}
      {loading ? (
        <p className="order-select__muted">読み込み中...</p>
      ) : shown.length === 0 ? (
        <p className="surgery-pending__empty">
          {rows.length > 0
            ? "絞り込みに該当する治療コースがありません。"
            : view === "open"
              ? "進行中の放射線治療はありません。"
              : "終了・中止した放射線治療はありません。"}
        </p>
      ) : (
        <ul className="surgery-pending__list">
          {shown.map((row) => (
            <li key={row.order.id}>
              <CourseCard
                row={row}
                dragging={drag.draggingOrderId === row.order.id}
                onPointerDown={(event) => drag.onCardPointerDown(row, event)}
                fractions={fractionsOf(row.order.id)}
                fractionsReady={fractionsReady}
                hasSummary={hasSummary(row.order.id)}
                pending={pending}
                onView={() => onView(row)}
                onPlan={() => onPlan(row)}
                onPerform={() => onPerform(row)}
                onSummarize={() => onSummarize(row)}
                onAction={(action) => onAction(row, action)}
                onClearPlanned={() => onClearPlanned(row)}
              />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function CourseCard({
  row,
  dragging,
  onPointerDown,
  fractions,
  fractionsReady,
  hasSummary,
  pending,
  onView,
  onPlan,
  onPerform,
  onSummarize,
  onAction,
  onClearPlanned,
}: {
  row: RadiotherapyWorklistRow;
  dragging: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
  fractions: RadiotherapyFractionDisplay[];
  fractionsReady: boolean;
  hasSummary: boolean;
  pending: boolean;
  onView: () => void;
  onPlan: () => void;
  onPerform: () => void;
  onSummarize: () => void;
  onAction: (action: RadiotherapyTaskAction) => void;
  onClearPlanned: () => void;
}) {
  const returnLinkState = useReturnLinkState();
  const { order, patient } = row;
  const summary = summarizeRadiotherapyOrder(order);
  const status = radiotherapyTaskStatus(row.task);
  const actions = radiotherapyTaskActions(status);
  const progress = radiotherapyProgress(summary, fractions);
  const closed = status === "completed" || status === "cancelled";
  const canPlan = radiotherapyPlanEligibility(status, summary, fractions).canPlan;
  // 照射記録が届くまでは回数を出さない(0 回と読めてしまう)。行の高さは変えない。
  const fractionLabel = !fractionsReady
    ? "照射 …"
    : `照射 ${progress.fractionLabel}${
        !closed && progress.planned ? `　予定 ${progress.planned} 回` : ""
      }${!closed && progress.nextPlannedDate ? `（次回 ${progress.nextPlannedDate}）` : ""}`;

  return (
    <div
      className={[
        "surgery-pending__card",
        canPlan ? "surgery-pending__card--movable" : "",
        dragging ? "surgery-pending__card--dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // 予定を足せるコースは、掴んでカレンダーの枠へ落とせる(手術の未確定リストと同じ)。
      onPointerDown={canPlan ? onPointerDown : undefined}
      title={canPlan ? "ドラッグしてカレンダーへ(その枠で照射予定を組む)" : undefined}
    >
      <span className="surgery-pending__card-head">
        <span className={`surgery-calendar__status is-${statusClass(status)}`}>
          {radiotherapyTaskStatusDisplay(status)}
        </span>
        <span className="surgery-pending__card-when">
          第{summary.courseNumber}コース {summary.intentDisplay}
        </span>
        <span className="surgery-pending__card-actions" onPointerDown={(e) => e.stopPropagation()}>
          <RowMenu label="この放射線治療の操作" escapesClipping>
            <button type="button" className="row-menu__item" onClick={onView}>
              表示
            </button>
            {status === "in-progress" && (
              <button type="button" className="row-menu__item" onClick={onPerform}>
                照射入力
              </button>
            )}
            {progress.planned > 0 && (
              <button
                type="button"
                className="row-menu__item row-menu__item--danger"
                disabled={pending}
                onClick={onClearPlanned}
              >
                予定をすべて削除
              </button>
            )}
            {actions
              .filter((action) => action.secondary)
              .map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className={`row-menu__item${
                    action.next === "cancelled" ? " row-menu__item--danger" : ""
                  }`}
                  disabled={pending}
                  onClick={() => onAction(action)}
                >
                  {action.label}
                </button>
              ))}
            {patient && (
              <Link to={`/patients/${patient.id}/karte`} state={returnLinkState} className="row-menu__item">
                カルテ表示
              </Link>
            )}
          </RowMenu>
        </span>
      </span>

      <span className="surgery-pending__card-patient">
        {patient ? (
          <>
            <span className="surgery-pending__card-mrn">{patient.identifier?.[0]?.value ?? "-"}</span>
            <span className="surgery-pending__card-patient-name">{displayName(patient)}</span>
            <PatientKana patient={patient} />
          </>
        ) : (
          "-"
        )}
      </span>
      <span className="surgery-pending__card-name">
        {summary.siteLabel} {summary.techniqueLabel}
      </span>
      <span className="surgery-pending__card-meta">{summary.doseLabel}</span>
      <span className="surgery-pending__card-meta">
        {closed
          ? [summary.endedOn && `終了 ${summary.endedOn}`, summary.terminationReason]
              .filter(Boolean)
              .join(" ") || fractionLabel
          : fractionLabel}
        {fractionsReady && progress.finished && !closed && (
          <span className="micro-result__badge">完了</span>
        )}
        {closed && !hasSummary && <span className="micro-result__badge">サマリー未作成</span>}
      </span>
      {summary.suspendedOn && (
        <span className="surgery-pending__card-meta">
          休止 {summary.suspendedOn} {summary.suspensionReason}
        </span>
      )}

      <span
        className="radiotherapy-calendar__course-actions"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {actions
          .filter((action) => !action.secondary)
          .map((action) => (
            <button key={action.label} type="button" disabled={pending} onClick={() => onAction(action)}>
              {action.label}
            </button>
          ))}
        {canPlan && (
          <button type="button" onClick={onPlan}>
            予定登録
          </button>
        )}
        {closed && (
          <button type="button" onClick={onSummarize}>
            {hasSummary ? "サマリー編集" : "サマリー"}
          </button>
        )}
      </span>
    </div>
  );
}

/** 治療コースの絞り込み。読んだ行に対して画面側で効かせる(他の部門一覧と同じ)。 */
interface CourseFilters {
  /** 治療装置のコード。NO_DEVICE_FILTER は「装置未定」。 */
  deviceCode: string;
  status: string;
  /** 氏名・患者番号の部分一致。 */
  patient: string;
}

const EMPTY_COURSE_FILTERS: CourseFilters = { deviceCode: "", status: "", patient: "" };

/** 「装置未定」を選んだときの値(空文字は「すべて」なので別の値を使う)。 */
const NO_DEVICE_FILTER = "__none__";

/**
 * そのコースが使う治療装置。**予定・実績の装置**を見て、無ければ Phase の使用予定装置で補う
 * (まだ日程を組んでいないコースも、装置で絞ったときに出るように)。
 */
function courseDeviceCodes(
  summary: RadiotherapyOrderSummary,
  fractions: RadiotherapyFractionDisplay[],
): Set<string> {
  const codes = new Set(fractions.map((fraction) => fraction.deviceCode));
  if (codes.size === 0) {
    for (const phase of summary.phases) {
      if (phase.status === "active") codes.add(phase.deviceCode);
    }
  }
  return codes;
}

function matchesCourseFilters(
  row: RadiotherapyWorklistRow,
  fractions: RadiotherapyFractionDisplay[],
  filters: CourseFilters,
  fractionsReady: boolean,
): boolean {
  const status = radiotherapyTaskStatus(row.task);
  if (filters.status && status !== filters.status) return false;

  const summary = summarizeRadiotherapyOrder(row.order);
  // 装置は予定・実績の装置で見るので、照射記録が届くまでは効かせない(届いた時点で絞る)。
  if (filters.deviceCode && fractionsReady) {
    const wanted = filters.deviceCode === NO_DEVICE_FILTER ? "" : filters.deviceCode;
    if (!courseDeviceCodes(summary, fractions).has(wanted)) return false;
  }

  const keyword = filters.patient.trim();
  if (keyword) {
    const patient = row.patient;
    const haystack = [
      patient?.identifier?.[0]?.value,
      patient ? displayName(patient) : "",
      patient?.name?.map((name) => [name.family, ...(name.given ?? [])].join("")).join(" "),
    ]
      .filter(Boolean)
      .join(" ");
    if (!haystack.includes(keyword)) return false;
  }

  return true;
}

/** 進捗の色。手術カレンダーの状態の色分け(受付済・進行中・実施済)に寄せる。 */
function statusClass(status: RadiotherapyTaskStatus): string {
  if (status === "in-progress") return "in-progress";
  if (status === "completed" || status === "cancelled") return "completed";
  if (status === "requested") return "requested";
  return "accepted";
}

// 終了・中止・休止の入力。終了は日付だけ、中止と休止は理由(マスタ)と補足も聞く。
const TERMINATION_LABELS = {
  completed: { title: "放射線治療の終了", date: "終了日", submit: "終了する", reasonKind: "" },
  cancelled: { title: "放射線治療の中止", date: "中止日", submit: "中止する", reasonKind: "terminate" },
  "on-hold": { title: "放射線治療の休止", date: "休止日", submit: "休止する", reasonKind: "suspend" },
} as const;

function TerminationModal({
  terminating,
  onClose,
}: {
  terminating: Terminating;
  onClose: () => void;
}) {
  const { row, action } = terminating;
  const labels = TERMINATION_LABELS[action.asksTermination ?? "completed"];
  const asksReason = labels.reasonKind !== "";
  const reasons = radiotherapyStopReasonHooks.useOptions({ kind: labels.reasonKind || undefined });
  const updateStatus = useUpdateRadiotherapyTaskStatus();
  const [endedOn, setEndedOn] = useState(today());
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const reason = reasons.items.find((r) => r.code === reasonCode);
    updateStatus.mutate(
      {
        order: row.order,
        task: row.task,
        status: action.next as RadiotherapyTaskStatus,
        termination: {
          endedOn,
          ...(reason ? { reason: { code: reason.code, name: reason.name } } : {}),
          note,
        },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title={labels.title} onClose={onClose}>
      <form className="prescription-form" onSubmit={handleSubmit}>
        <ErrorBanner error={updateStatus.error} />
        <fieldset>
          <label>
            {labels.date} *
            <input type="date" value={endedOn} onChange={(e) => setEndedOn(e.target.value)} required />
          </label>
          {asksReason && (
            <>
              <label>
                理由 *
                <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} required>
                  <option value="">選択してください</option>
                  {reasons.items.map((reason) => (
                    <option key={reason.code} value={reason.code}>
                      {reason.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                補足
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </>
          )}
        </fieldset>
        <div className="prescription-form__actions">
          <button type="submit" disabled={updateStatus.isPending}>
            {updateStatus.isPending ? "保存中..." : labels.submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
