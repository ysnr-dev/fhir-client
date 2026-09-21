import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { radiotherapyStopReasonHooks } from "../api/masterQueries";
import {
  useCancelRadiotherapyFraction,
  useRadiotherapyProcedures,
  useRadiotherapyWorklist,
  useUpdateRadiotherapyTaskStatus,
  type RadiotherapyWorklistRow,
  type RadiotherapyWorklistView,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { RadiotherapyOrderDetailPanel } from "../components/RadiotherapyOrderDetailPanel";
import { RadiotherapyCourseSummaryModal } from "../components/RadiotherapyCourseSummaryModal";
import { RadiotherapyPerformModal } from "../components/RadiotherapyPerformModal";
import { RowMenu } from "../components/RowMenu";
import { displayName } from "../fhir/patientHelpers";
import {
  SETTING_OPTIONS,
  orderContextSummary,
  prescriptionRequester,
} from "../fhir/prescriptionHelpers";
import {
  RADIOTHERAPY_INTENT_OPTIONS,
  summarizeRadiotherapyOrder,
} from "../fhir/radiotherapyOrderHelpers";
import {
  radiotherapyProgress,
  type RadiotherapyFractionDisplay,
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

// 放射線治療一覧(部門ワークリスト)。
//
// 治療コースは数週間続くので、他科依頼一覧と同じく日付ではなく ServiceRequest.status で
// 切る(docs/radiotherapy-order-design.md §4.1)。
//
// - 進行中     … status=active(処方済・計画中・治療中)。いま抱えているコース。
// - 終了・中止 … status=completed / revoked の直近ぶん(登録日の降順)。
//
// 進捗の変更は Task と ServiceRequest.status を同じ transaction で書く。終了と中止は
// 日付(と中止理由)を聞いてから進める。

interface Filters {
  status: string;
  intent: string;
  setting: string;
}

const EMPTY_FILTERS: Filters = { status: "", intent: "", setting: "" };

interface Terminating {
  row: RadiotherapyWorklistRow;
  action: RadiotherapyTaskAction;
}

export function RadiotherapyWorklistPage() {
  const [view, setView] = useState<RadiotherapyWorklistView>("open");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [terminating, setTerminating] = useState<Terminating | null>(null);

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useRadiotherapyWorklist(view);
  // 照射記録と治療終了サマリー。進行中は回数と累積線量に、終了・中止はサマリーの有無に使う。
  const procedures = useRadiotherapyProcedures();
  const updateStatus = useUpdateRadiotherapyTaskStatus();
  const cancelFraction = useCancelRadiotherapyFraction();
  const [performingId, setPerformingId] = useState<string | null>(null);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);

  const allRows = useMemo(() => worklist.data?.rows ?? [], [worklist.data]);
  const rows = useMemo(() => allRows.filter((row) => matchesFilters(row, filters)), [allRows, filters]);
  const viewing = allRows.find((row) => row.order.id === viewingId);
  const performing = allRows.find((row) => row.order.id === performingId);
  const summarizing = allRows.find((row) => row.order.id === summarizingId);
  const fractionsOf = (orderId: string | undefined) =>
    procedures.data?.fractions.get(orderId ?? "") ?? EMPTY_FRACTIONS;
  const summaryOf = (orderId: string | undefined) => procedures.data?.summaries.get(orderId ?? "");

  function handleAction(row: RadiotherapyWorklistRow, action: RadiotherapyTaskAction) {
    if (action.asksTermination) return setTerminating({ row, action });
    updateStatus.mutate({ order: row.order, task: row.task, status: action.next });
  }

  // 進行中のビューでは終了・中止を選べない(行が無い)ので、選択肢をビューに合わせる。
  const statusOptions = RADIOTHERAPY_TASK_STATUS_OPTIONS.filter((o) =>
    view === "open"
      ? o.code !== "completed" && o.code !== "cancelled"
      : o.code === "completed" || o.code === "cancelled",
  );

  return (
    <div className="page">
      <div className="page__header">
        <h1>放射線治療一覧</h1>
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
            onClick={() => {
              setView(code);
              setFilters((f) => ({ ...f, status: "" }));
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <form className="patient-search-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          ステータス
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">すべて</option>
            {statusOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          治療目的
          <select
            value={filters.intent}
            onChange={(e) => setFilters({ ...filters, intent: e.target.value })}
          >
            <option value="">すべて</option>
            {RADIOTHERAPY_INTENT_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          入外区分
          <select
            value={filters.setting}
            onChange={(e) => setFilters({ ...filters, setting: e.target.value })}
          >
            <option value="">すべて</option>
            {SETTING_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={procedures.error} />
      <ErrorBanner error={updateStatus.error} />
      <ErrorBanner error={cancelFraction.error} />

      {worklist.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          放射線治療が多いため、一部のみ表示しています。
        </p>
      )}

      {worklist.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="sticky-table__fix-1">患者番号</th>
                  <th className="sticky-table__fix-2">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="lab-worklist__compact">コース</th>
                  <th className="lab-worklist__compact">目的</th>
                  <th>部位</th>
                  <th>処方</th>
                  <th className="lab-worklist__compact">技法</th>
                  <th className="lab-worklist__compact">開始予定日</th>
                  <th className="lab-worklist__compact">{view === "open" ? "照射" : "サマリー"}</th>
                  <th className="lab-worklist__compact">{view === "closed" ? "終了日" : "入外"}</th>
                  <th>担当医</th>
                  <th>依頼科 | 依頼医師</th>
                  <th className="lab-worklist__compact">ステータス</th>
                  <th className="lab-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <OrderRow
                    key={row.order.id}
                    row={row}
                    view={view}
                    fractions={fractionsOf(row.order.id)}
                    courseSummary={summaryOf(row.order.id)}
                    pending={updateStatus.isPending}
                    onView={() => setViewingId(row.order.id ?? null)}
                    onPerform={() => setPerformingId(row.order.id ?? null)}
                    onSummarize={() => setSummarizingId(row.order.id ?? null)}
                    onAction={(action) => handleAction(row, action)}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={17} className="master-search__empty">
                      {allRows.length === 0
                        ? view === "open"
                          ? "進行中の放射線治療はありません"
                          : "終了・中止した放射線治療はありません"
                        : "絞り込みに該当する放射線治療がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      )}

      {viewing && (
        <Modal
          title={`放射線治療内容 - ${viewing.patient ? displayName(viewing.patient) : ""}`}
          onClose={() => setViewingId(null)}
          className="modal--wide"
        >
          <RadiotherapyOrderDetailPanel
            serviceRequest={viewing.order}
            taskStatus={radiotherapyTaskStatus(viewing.task)}
            fractions={fractionsOf(viewing.order.id)}
            courseSummary={summaryOf(viewing.order.id)}
            onCancelFraction={(fractionId) => cancelFraction.mutate(fractionId)}
            cancellingFractionId={cancelFraction.isPending ? cancelFraction.variables : undefined}
          />
        </Modal>
      )}

      {performing && (
        <RadiotherapyPerformModal
          order={performing.order}
          fractions={fractionsOf(performing.order.id)}
          patientName={performing.patient ? displayName(performing.patient) : undefined}
          onClose={() => setPerformingId(null)}
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
        <TerminationModal
          terminating={terminating}
          onClose={() => setTerminating(null)}
        />
      )}
    </div>
  );
}

function matchesFilters(row: RadiotherapyWorklistRow, filters: Filters): boolean {
  const summary = summarizeRadiotherapyOrder(row.order);
  if (filters.status && radiotherapyTaskStatus(row.task) !== filters.status) return false;
  if (filters.intent && summary.intent !== filters.intent) return false;
  if (
    filters.setting &&
    SETTING_OPTIONS.find((o) => o.code === filters.setting)?.display !== summary.settingDisplay
  ) {
    return false;
  }
  return true;
}

const EMPTY_FRACTIONS: RadiotherapyFractionDisplay[] = [];

function OrderRow({
  row,
  view,
  fractions,
  courseSummary,
  pending,
  onView,
  onPerform,
  onSummarize,
  onAction,
}: {
  row: RadiotherapyWorklistRow;
  view: RadiotherapyWorklistView;
  fractions: RadiotherapyFractionDisplay[];
  courseSummary?: fhir4.Procedure;
  pending: boolean;
  onView: () => void;
  onPerform: () => void;
  onSummarize: () => void;
  onAction: (action: RadiotherapyTaskAction) => void;
}) {
  const returnLinkState = useReturnLinkState();
  const { order, patient } = row;
  const summary = summarizeRadiotherapyOrder(order);
  const status = radiotherapyTaskStatus(row.task);
  const actions = radiotherapyTaskActions(status);
  const secondaryActions = actions.filter((action) => action.secondary);
  const progress = radiotherapyProgress(summary, fractions);

  return (
    <tr>
      <td className="sticky-table__fix-1">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-2">
        {patient ? (
          <>
            <Link to={`/patients/${patient.id}/karte`} state={returnLinkState}>
              {displayName(patient)}
            </Link>
            <PatientKana patient={patient} />
          </>
        ) : (
          "-"
        )}
      </td>
      <PatientProfileCells patient={patient} />
      <td className="lab-worklist__compact">第{summary.courseNumber}</td>
      <td className="lab-worklist__compact">{summary.intentDisplay || "-"}</td>
      <td>{summary.siteLabel || "-"}</td>
      <td>{summary.doseLabel || "-"}</td>
      <td className="lab-worklist__compact">{summary.techniqueLabel || "-"}</td>
      <td className="lab-worklist__compact">{summary.startDate || "-"}</td>
      {view === "open" ? (
        <td className="lab-worklist__compact" title={progress.volumes.map((v) => `${v.label} ${v.doseLabel}`).join("\n")}>
          {progress.fractionLabel}
          {/* 処方の回数に達したコースは、終了の操作を促すために印を出す。 */}
          {progress.finished && <span className="micro-result__badge">完了</span>}
        </td>
      ) : (
        <td className="lab-worklist__compact">
          {courseSummary ? (
            "作成済"
          ) : (
            <span className="micro-result__badge">未作成</span>
          )}
        </td>
      )}
      <td className="lab-worklist__compact">
        {view === "closed"
          ? [summary.endedOn, summary.terminationReason].filter(Boolean).join(" ") || "-"
          : summary.settingDisplay || "-"}
      </td>
      <td>{summary.practitionerName || order.requester?.display || "-"}</td>
      <td>{orderContextSummary(prescriptionRequester(order)) || "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {radiotherapyTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="lab-worklist__actions sticky-table__fix-actions">
        {/* 照射入力・サマリーは状態を選ぶ操作ではないので、進捗ボタンとは別に出す。 */}
        {status === "in-progress" && (
          <button type="button" onClick={onPerform}>
            照射入力
          </button>
        )}
        {(status === "completed" || status === "cancelled") && (
          <button type="button" onClick={onSummarize}>
            {courseSummary ? "サマリー編集" : "サマリー"}
          </button>
        )}
        {actions
          .filter((action) => !action.secondary)
          .map((action) => (
            <button key={action.label} type="button" disabled={pending} onClick={() => onAction(action)}>
              {action.label}
            </button>
          ))}
        <button type="button" onClick={onView}>
          表示
        </button>
        {secondaryActions.length > 0 && (
          <RowMenu label="この放射線治療の操作" escapesClipping>
            {secondaryActions.map((action) => (
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
          </RowMenu>
        )}
      </td>
    </tr>
  );
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
