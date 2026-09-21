import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { radiotherapyStopReasonHooks } from "../api/masterQueries";
import {
  useCancelRadiotherapyFraction,
  useDeleteRadiotherapyPlanned,
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
  type RadiotherapyCalendarMode,
} from "../components/RadiotherapyCalendar";
import { RadiotherapyCourseSummaryModal } from "../components/RadiotherapyCourseSummaryModal";
import { RadiotherapyOrderDetailPanel } from "../components/RadiotherapyOrderDetailPanel";
import { RadiotherapyPerformModal } from "../components/RadiotherapyPerformModal";
import {
  RadiotherapyPlanModal,
  RadiotherapyRescheduleModal,
} from "../components/RadiotherapyPlanModal";
import { RowMenu } from "../components/RowMenu";
import { displayName } from "../fhir/patientHelpers";
import { summarizeRadiotherapyOrder } from "../fhir/radiotherapyOrderHelpers";
import {
  radiotherapyProgress,
  type RadiotherapyFractionDisplay,
} from "../fhir/radiotherapyResultHelpers";
import {
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
// 日々の流れ: コースを受け付けて治療を始める → 「予定登録」で処方の回数ぶんの照射予定を
// 作る → 当日は格子の予定の「実施」を押し、入っている値を確かめて登録する。
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
  const [planningId, setPlanningId] = useState<string | null>(null);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [terminating, setTerminating] = useState<Terminating | null>(null);
  // 実施入力。格子の予定から開いたときはその予定を、コースから開いたときは次の回を入れる。
  const [performing, setPerforming] = useState<(Target & { plannedId?: string }) | null>(null);
  const [rescheduling, setRescheduling] = useState<RadiotherapyCalendarEntry | null>(null);

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useRadiotherapyWorklist(view);
  const procedures = useRadiotherapyProcedures();
  const updateStatus = useUpdateRadiotherapyTaskStatus();
  const cancelFraction = useCancelRadiotherapyFraction();
  const deletePlanned = useDeleteRadiotherapyPlanned();

  const rows = useMemo(() => worklist.data?.rows ?? [], [worklist.data]);
  const rowOf = (orderId: string | null | undefined) => rows.find((row) => row.order.id === orderId);
  const fractionsOf = (orderId: string | undefined) =>
    procedures.data?.fractions.get(orderId ?? "") ?? EMPTY_FRACTIONS;
  const summaryOf = (orderId: string | undefined) => procedures.data?.summaries.get(orderId ?? "");

  const planning = rowOf(planningId);
  const summarizing = rowOf(summarizingId);

  function handleAction(row: RadiotherapyWorklistRow, action: RadiotherapyTaskAction) {
    if (action.asksTermination) return setTerminating({ row, action });
    updateStatus.mutate({ order: row.order, task: row.task, status: action.next });
  }

  function handleDeletePlanned(ids: string[]) {
    if (ids.length > 0) deletePlanned.mutate(ids);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>放射線治療カレンダー</h1>
      </div>

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={procedures.error} />
      <ErrorBanner error={updateStatus.error} />
      <ErrorBanner error={cancelFraction.error} />
      <ErrorBanner error={deletePlanned.error} />

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
        onView={(entry) => {
          if (entry.order) setViewing({ order: entry.order, patient: entry.patient });
        }}
        panel={
          <CoursePanel
            view={view}
            onViewChange={setView}
            rows={rows}
            loading={worklist.isLoading}
            truncated={Boolean(worklist.data?.truncated)}
            fractionsOf={fractionsOf}
            hasSummary={(orderId) => Boolean(summaryOf(orderId))}
            pending={updateStatus.isPending || deletePlanned.isPending}
            onView={(row) => setViewing({ order: row.order, patient: row.patient })}
            onPlan={(row) => setPlanningId(row.order.id ?? null)}
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
        }
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
            fractions={fractionsOf(viewing.order.id)}
            courseSummary={summaryOf(viewing.order.id)}
            onCancelFraction={(fractionId) => cancelFraction.mutate(fractionId)}
            cancellingFractionId={cancelFraction.isPending ? cancelFraction.variables : undefined}
          />
        </Modal>
      )}

      {planning && (
        <RadiotherapyPlanModal
          order={planning.order}
          fractions={fractionsOf(planning.order.id)}
          patientName={planning.patient ? displayName(planning.patient) : undefined}
          onClose={() => setPlanningId(null)}
        />
      )}

      {performing && (
        <RadiotherapyPerformModal
          order={performing.order}
          fractions={fractionsOf(performing.order.id)}
          plannedId={performing.plannedId}
          patientName={performing.patient ? displayName(performing.patient) : undefined}
          onClose={() => setPerforming(null)}
        />
      )}

      {rescheduling && (
        <RadiotherapyRescheduleModal
          fraction={rescheduling.fraction}
          patientName={rescheduling.patient ? displayName(rescheduling.patient) : undefined}
          onClose={() => setRescheduling(null)}
        />
      )}

      {summarizing && (
        <RadiotherapyCourseSummaryModal
          order={summarizing.order}
          fractions={fractionsOf(summarizing.order.id)}
          existing={summaryOf(summarizing.order.id)}
          patientName={summarizing.patient ? displayName(summarizing.patient) : undefined}
          onClose={() => setSummarizingId(null)}
        />
      )}

      {terminating && (
        <TerminationModal terminating={terminating} onClose={() => setTerminating(null)} />
      )}
    </div>
  );
}

// 右のパネル。治療コースの一覧(進行中 / 終了・中止)。
function CoursePanel({
  view,
  onViewChange,
  rows,
  loading,
  truncated,
  fractionsOf,
  hasSummary,
  pending,
  onView,
  onPlan,
  onPerform,
  onSummarize,
  onAction,
  onClearPlanned,
}: {
  view: RadiotherapyWorklistView;
  onViewChange: (view: RadiotherapyWorklistView) => void;
  rows: RadiotherapyWorklistRow[];
  loading: boolean;
  truncated: boolean;
  fractionsOf: (orderId: string | undefined) => RadiotherapyFractionDisplay[];
  hasSummary: (orderId: string | undefined) => boolean;
  pending: boolean;
  onView: (row: RadiotherapyWorklistRow) => void;
  onPlan: (row: RadiotherapyWorklistRow) => void;
  onPerform: (row: RadiotherapyWorklistRow) => void;
  onSummarize: (row: RadiotherapyWorklistRow) => void;
  onAction: (row: RadiotherapyWorklistRow, action: RadiotherapyTaskAction) => void;
  onClearPlanned: (row: RadiotherapyWorklistRow) => void;
}) {
  return (
    <aside className="surgery-pending">
      <div className="surgery-pending__head">
        <span className="surgery-pending__title">治療コース</span>
        <span className="surgery-pending__count">{rows.length} 件</span>
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

      {truncated && (
        <p className="order-select__muted" role="status">
          コースが多いため、一部のみ表示しています。
        </p>
      )}
      {loading ? (
        <p className="order-select__muted">読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="surgery-pending__empty">
          {view === "open" ? "進行中の放射線治療はありません。" : "終了・中止した放射線治療はありません。"}
        </p>
      ) : (
        <ul className="surgery-pending__list">
          {rows.map((row) => (
            <li key={row.order.id}>
              <CourseCard
                row={row}
                fractions={fractionsOf(row.order.id)}
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
  fractions,
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
  fractions: RadiotherapyFractionDisplay[];
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
  // 予定を作れるのは受付後(計画中・治療中・休止)。残りが無ければ出さない。
  const canPlan =
    (status === "accepted" || status === "in-progress" || status === "on-hold") &&
    progress.delivered + progress.planned < progress.prescribed;

  return (
    <div className="surgery-pending__card">
      <span className="surgery-pending__card-head">
        <span className={`surgery-calendar__status is-${statusClass(status)}`}>
          {radiotherapyTaskStatusDisplay(status)}
        </span>
        <span className="surgery-pending__card-when">
          第{summary.courseNumber}コース {summary.intentDisplay}
        </span>
        <span className="surgery-pending__card-actions">
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
              .join(" ") || `照射 ${progress.fractionLabel}`
          : `照射 ${progress.fractionLabel}${progress.planned ? `　予定 ${progress.planned} 回` : ""}${
              progress.nextPlannedDate ? `（次回 ${progress.nextPlannedDate}）` : ""
            }`}
        {progress.finished && !closed && <span className="micro-result__badge">完了</span>}
        {closed && !hasSummary && <span className="micro-result__badge">サマリー未作成</span>}
      </span>
      {summary.suspendedOn && (
        <span className="surgery-pending__card-meta">
          休止 {summary.suspendedOn} {summary.suspensionReason}
        </span>
      )}

      <span className="radiotherapy-calendar__course-actions">
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
