import { useEffect, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useCareTeams,
  useMyCareTeams,
  useSelfDepartments,
  useSetTeamRequestNextRound,
  useTeamRequestWorklist,
  useUpdateTeamRequestTaskStatus,
  type TeamRequestWorklistRow,
  type TeamRequestWorklistView,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { PatientProfileDrawer, useRowDrawer } from "../components/PatientProfileDrawer";
import { PatientKana, PatientProfileCells, PatientProfileHeadCells } from "../components/PatientRowCells";
import { RowMenu } from "../components/RowMenu";
import { TeamRequestDetailPanel } from "../components/TeamRequestDetailPanel";
import { TeamRoundModal } from "../components/TeamRoundModal";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { careTeamName } from "../fhir/careTeamHelpers";
import { displayName } from "../fhir/patientHelpers";
import { orderContextSummary, orderRequester, wardOf } from "../fhir/orderHeader";
import { SETTING_OPTIONS } from "../fhir/prescriptionHelpers";
import { summarizeTeamRequest } from "../fhir/teamRequestHelpers";
import {
  TEAM_REQUEST_TASK_STATUS_OPTIONS,
  teamRequestCancelReason,
  teamRequestTaskActions,
  teamRequestTaskStatus,
  teamRequestTaskStatusDisplay,
  type TeamRequestTaskAction,
} from "../fhir/teamRequestTaskHelpers";
import { today } from "../lib/dates";

// チーム依頼一覧(docs/care-team-design.md §4)。他科依頼一覧と同じく日付軸ではなく status で切る。
//
// - 介入中 … status=active / revoked(依頼済・介入中・却下)。いま溜まっている仕事なので有限
// - 終了 … status=completed の直近ぶん
//
// 宛先のチームは performer=CareTeam/{id} で上流が絞る。既定は自分がメンバーのチームの先頭。
// 回診記録は進捗ボタンではなくモーダル(TeamRoundModal)で書く。却下は理由を入れるモーダル。

interface Filters {
  teamId: string;
  setting: string;
  wardId: string;
  requesterDepartmentId: string;
  status: string;
  urgentOnly: boolean;
  /** 次回回診日が今日以前(回診の期限が来ている)だけ。 */
  dueOnly: boolean;
}

function emptyFilters(teamId: string): Filters {
  return { teamId, setting: "", wardId: "", requesterDepartmentId: "", status: "", urgentOnly: false, dueOnly: false };
}

export function TeamWorklistPage() {
  const [view, setView] = useState<TeamRequestWorklistView>("open");
  const { practitionerId } = useCurrentPractitioner();
  const myTeams = useMyCareTeams(practitionerId);
  const teams = useCareTeams();
  const [filters, setFilters] = useState<Filters | null>(null);
  // 既定のチームは自分がメンバーのチームの先頭(読めるまでは全チーム)。
  const defaultTeamId = myTeams.data?.[0]?.id ?? "";
  const effectiveFilters = filters ?? emptyFilters(defaultTeamId);

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [roundingId, setRoundingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [nextRoundId, setNextRoundId] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useTeamRequestWorklist(view, effectiveFilters.teamId);
  const departments = useSelfDepartments();
  const updateStatus = useUpdateTeamRequestTaskStatus();
  const setNextRound = useSetTeamRequestNextRound();

  const allRows = useMemo(() => worklist.data?.rows ?? [], [worklist.data]);
  const rows = useMemo(() => allRows.filter((row) => matchesFilters(row, effectiveFilters)), [allRows, effectiveFilters]);

  const viewing = allRows.find((row) => row.order.id === viewingId);
  const rounding = allRows.find((row) => row.order.id === roundingId);
  const cancelling = allRows.find((row) => row.order.id === cancellingId);
  const nextRounding = allRows.find((row) => row.order.id === nextRoundId);
  const teamOf = (row: TeamRequestWorklistRow) => teams.data?.find((t) => t.id === summarizeTeamRequest(row.order).teamId);

  const drawer = useRowDrawer();
  const selectedRow = rows.find((row) => row.patient?.id && row.order.id === drawer.selectedKey);

  const wardOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of allRows) {
      const ward = wardOf(row.order);
      if (ward.wardId && !byId.has(ward.wardId)) byId.set(ward.wardId, ward.wardName || ward.wardId);
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows]);

  // 自分のチームを先頭に、残りの有効なチームを並べる。
  const teamOptions = useMemo(() => {
    const mine = myTeams.data ?? [];
    const rest = (teams.data ?? []).filter((t) => !mine.some((m) => m.id === t.id));
    return [...mine, ...rest];
  }, [myTeams.data, teams.data]);

  function handleAction(row: TeamRequestWorklistRow, action: TeamRequestTaskAction) {
    if (action.reason) {
      setCancellingId(row.order.id ?? null);
      return;
    }
    updateStatus.mutate({ order: row.order, task: row.task, status: action.next });
  }

  const actions = (row: TeamRequestWorklistRow) => ({
    pending: updateStatus.isPending,
    onView: () => setViewingId(row.order.id ?? null),
    onRound: () => setRoundingId(row.order.id ?? null),
    onNextRound: () => setNextRoundId(row.order.id ?? null),
    onAction: (action: TeamRequestTaskAction) => handleAction(row, action),
  });

  return (
    <div className="page">
      <div className="page__header">
        <h1>チーム依頼一覧</h1>
      </div>

      <div className="order-select__tabs" role="tablist">
        {(
          [
            ["open", "介入中"],
            ["closed", "終了"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            className={view === key ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          チーム
          <select value={effectiveFilters.teamId} onChange={(e) => setFilters({ ...effectiveFilters, teamId: e.target.value })}>
            <option value="">すべて</option>
            {teamOptions.map((team) => (
              <option key={team.id} value={team.id}>
                {careTeamName(team)}
              </option>
            ))}
          </select>
        </label>
        <label>
          入外区分
          <select value={effectiveFilters.setting} onChange={(e) => setFilters({ ...effectiveFilters, setting: e.target.value })}>
            <option value="">すべて</option>
            {SETTING_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          病棟
          <select value={effectiveFilters.wardId} onChange={(e) => setFilters({ ...effectiveFilters, wardId: e.target.value })}>
            <option value="">すべて</option>
            {wardOptions.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {ward.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          依頼元の診療科
          <select
            value={effectiveFilters.requesterDepartmentId}
            onChange={(e) => setFilters({ ...effectiveFilters, requesterDepartmentId: e.target.value })}
          >
            <option value="">すべて</option>
            {departments.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          ステータス
          <select value={effectiveFilters.status} onChange={(e) => setFilters({ ...effectiveFilters, status: e.target.value })}>
            <option value="">すべて</option>
            {TEAM_REQUEST_TASK_STATUS_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label className="patient-search-form__check">
          <input
            type="checkbox"
            checked={effectiveFilters.urgentOnly}
            onChange={(e) => setFilters({ ...effectiveFilters, urgentOnly: e.target.checked })}
          />
          至急のみ
        </label>
        <label className="patient-search-form__check">
          <input
            type="checkbox"
            checked={effectiveFilters.dueOnly}
            onChange={(e) => setFilters({ ...effectiveFilters, dueOnly: e.target.checked })}
          />
          回診予定のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={() => setFilters(emptyFilters(defaultTeamId))}>
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={teams.error} />
      <ErrorBanner error={updateStatus.error} />
      <ErrorBanner error={setNextRound.error} />
      <TruncatedNotice show={worklist.data?.truncated}>チーム依頼が多いため、一部のみ表示しています。</TruncatedNotice>

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
                  <th className="lab-worklist__compact">依頼日</th>
                  <th>チーム</th>
                  <th>依頼目的</th>
                  <th className="lab-worklist__compact">入外</th>
                  <th className="lab-worklist__compact">病棟</th>
                  <th>依頼科 | 依頼医師</th>
                  <th className="lab-worklist__compact">最終回診</th>
                  <th className="lab-worklist__compact">次回回診</th>
                  <th className="lab-worklist__compact">ステータス</th>
                  <th className="lab-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <OrderRow key={row.order.id} row={row} rowProps={drawer.rowProps(row.patient?.id && row.order.id)} {...actions(row)} />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={15} className="master-search__empty">
                      {allRows.length === 0
                        ? view === "open"
                          ? "介入中のチーム依頼はありません"
                          : "終了したチーム依頼はありません"
                        : "絞り込みに該当するチーム依頼がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      )}

      {selectedRow?.patient?.id && (
        <PatientProfileDrawer
          patientId={selectedRow.patient.id}
          patient={selectedRow.patient}
          actions={
            <>
              <RowButtons row={selectedRow} {...actions(selectedRow)} />
              <MenuItems row={selectedRow} {...actions(selectedRow)} />
            </>
          }
          onClose={drawer.close}
        />
      )}

      {viewing && (
        <Modal
          title={`チーム依頼内容 - ${viewing.patient ? displayName(viewing.patient) : ""}`}
          onClose={() => setViewingId(null)}
          className="modal--wide"
        >
          <TeamRequestDetailPanel serviceRequest={viewing.order} task={viewing.task} />
        </Modal>
      )}

      {rounding && (
        <TeamRoundModal
          order={rounding.order}
          task={rounding.task}
          team={teamOf(rounding)}
          patientId={rounding.order.subject?.reference?.split("/").pop() ?? ""}
          patientName={rounding.patient ? displayName(rounding.patient) : undefined}
          onClose={() => setRoundingId(null)}
        />
      )}

      {cancelling && (
        <ReasonModal
          title={`却下 - ${cancelling.patient ? displayName(cancelling.patient) : ""}`}
          initial={teamRequestCancelReason(cancelling.task)}
          submitting={updateStatus.isPending}
          onSubmit={(reason) =>
            updateStatus.mutate(
              { order: cancelling.order, task: cancelling.task, status: "cancelled", reason },
              { onSuccess: () => setCancellingId(null) },
            )
          }
          onClose={() => setCancellingId(null)}
        />
      )}

      {nextRounding && (
        <NextRoundModal
          title={`次回回診日 - ${nextRounding.patient ? displayName(nextRounding.patient) : ""}`}
          initial={summarizeTeamRequest(nextRounding.order).nextRoundDate}
          submitting={setNextRound.isPending}
          onSubmit={(date) =>
            setNextRound.mutate({ order: nextRounding.order, date }, { onSuccess: () => setNextRoundId(null) })
          }
          onClose={() => setNextRoundId(null)}
        />
      )}
    </div>
  );
}

function matchesFilters(row: TeamRequestWorklistRow, filters: Filters): boolean {
  const summary = summarizeTeamRequest(row.order);
  if (filters.urgentOnly && !summary.urgent) return false;
  if (filters.dueOnly && !(summary.nextRoundDate && summary.nextRoundDate <= today())) return false;
  if (filters.setting && SETTING_OPTIONS.find((o) => o.code === filters.setting)?.display !== summary.settingDisplay) return false;
  if (filters.wardId && wardOf(row.order).wardId !== filters.wardId) return false;
  const requester = orderRequester(row.order);
  if (filters.requesterDepartmentId && requester.departmentId !== filters.requesterDepartmentId) return false;
  if (filters.status && teamRequestTaskStatus(row.task) !== filters.status) return false;
  return true;
}

interface RowActions {
  pending: boolean;
  onView: () => void;
  onRound: () => void;
  onNextRound: () => void;
  onAction: (action: TeamRequestTaskAction) => void;
}

function OrderRow({ row, rowProps, ...actions }: { row: TeamRequestWorklistRow; rowProps: ComponentProps<"tr"> } & RowActions) {
  const returnLinkState = useReturnLinkState();
  const { order, patient } = row;
  const summary = summarizeTeamRequest(order);
  const requester = orderRequester(order);
  const status = teamRequestTaskStatus(row.task);
  const due = Boolean(summary.nextRoundDate) && summary.nextRoundDate <= today() && status === "accepted";
  const reason = teamRequestCancelReason(row.task);

  return (
    <tr {...rowProps}>
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
      <td className="lab-worklist__compact">
        {order.authoredOn?.slice(0, 10) ?? "-"}
        {summary.urgent && <span className="micro-result__badge">至急</span>}
      </td>
      <td>{summary.teamName || "-"}</td>
      <td className="consult-worklist__purpose" title={summary.purpose}>
        {summary.purpose || "-"}
      </td>
      <td className="lab-worklist__compact">{summary.settingDisplay || "-"}</td>
      <td className="lab-worklist__compact">{wardOf(order).wardName || "-"}</td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="lab-worklist__compact">{summary.lastRoundDate || "-"}</td>
      <td className={`lab-worklist__compact${due ? " team-worklist__due" : ""}`}>{summary.nextRoundDate || "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`} title={reason || undefined}>
          {teamRequestTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="lab-worklist__actions sticky-table__fix-actions">
        <RowButtons row={row} {...actions} />
        <RowMenu label="このチーム依頼の操作" escapesClipping>
          <MenuItems row={row} {...actions} />
        </RowMenu>
      </td>
    </tr>
  );
}

/** 行の操作列に直接並べるボタン。ドロワーにも同じものを並べる。 */
function RowButtons({ row, pending, onView, onRound, onAction }: { row: TeamRequestWorklistRow } & RowActions) {
  const status = teamRequestTaskStatus(row.task);
  return (
    <>
      {teamRequestTaskActions(status)
        .filter((action) => !action.secondary)
        .map((action) => (
          <button key={action.next} type="button" disabled={pending} onClick={() => onAction(action)}>
            {action.label}
          </button>
        ))}
      {(status === "requested" || status === "accepted") && (
        <button type="button" onClick={onRound}>
          回診記録
        </button>
      )}
      <button type="button" onClick={onView}>
        表示
      </button>
    </>
  );
}

/** ケバブに畳む操作(却下・取消の訂正・次回回診日の変更)。 */
function MenuItems({ row, pending, onNextRound, onAction }: { row: TeamRequestWorklistRow } & RowActions) {
  const status = teamRequestTaskStatus(row.task);
  return (
    <>
      {status === "accepted" && (
        <button type="button" className="row-menu__item" disabled={pending} onClick={onNextRound}>
          次回回診日
        </button>
      )}
      {teamRequestTaskActions(status)
        .filter((action) => action.secondary)
        .map((action) => (
          <button
            key={action.next}
            type="button"
            className={`row-menu__item${action.next === "cancelled" ? " row-menu__item--danger" : ""}`}
            disabled={pending}
            onClick={() => onAction(action)}
          >
            {action.label}
          </button>
        ))}
    </>
  );
}

// Modal はポータルではないので <form> は書かない。
function ReasonModal({
  title,
  initial,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: string;
  submitting: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="prescription-form">
        <label>
          理由
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="lab-order-item__actions">
          <button type="button" disabled={!reason.trim() || submitting} onClick={() => onSubmit(reason.trim())}>
            却下
          </button>
          <button type="button" onClick={onClose} disabled={submitting}>
            取消
          </button>
        </div>
      </div>
    </Modal>
  );
}

function NextRoundModal({
  title,
  initial,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: string;
  submitting: boolean;
  onSubmit: (date: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="prescription-form">
        <label>
          次回回診日
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="lab-order-item__actions">
          <button type="button" disabled={submitting} onClick={() => onSubmit(date)}>
            登録
          </button>
          <button type="button" onClick={onClose} disabled={submitting}>
            取消
          </button>
        </div>
      </div>
    </Modal>
  );
}
