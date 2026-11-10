import { useEffect, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  useCancelAppointment,
  useDialysisBoard,
  useDialysisPerform,
  useDialysisSessions,
  useDialysisShifts,
  useDialysisSlots,
  useDialysisUnits,
  useDialysisWorklist,
  useUpdateDialysisTaskStatus,
  type DialysisWorklistRow,
} from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { DialysisBoard, type DialysisBoardEntry, type DialysisPerformAction } from "../components/DialysisBoard";
import { DialysisBookModal } from "../components/DialysisBookModal";
import { DialysisExpandModal } from "../components/DialysisExpandModal";
import { DialysisOrderDetailPanel } from "../components/DialysisOrderDetailPanel";
import { DialysisPerformModal } from "../components/DialysisPerformModal";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { RowPictograms } from "../components/PatientListRowParts";
import { PatientProfileDrawer, useRowDrawer } from "../components/PatientProfileDrawer";
import { PatientKana, PatientProfileCells, PatientProfileHeadCells } from "../components/PatientRowCells";
import { RowMenu } from "../components/RowMenu";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { appointmentOrderId } from "../fhir/appointmentHelpers";
import { dialysisAppointmentDate, dialysisAppointmentShift } from "../fhir/dialysisAppointmentHelpers";
import type { DialysisShift } from "../fhir/dialysisShiftHelpers";
import { DIALYSIS_MODALITY_OPTIONS, summarizeDialysisOrder } from "../fhir/dialysisOrderHelpers";
import {
  buildDialysisArrivalBundle,
  buildDialysisPerformDeleteBundle,
  dialysisSessionAppointmentId,
  dialysisSessionDay,
  dialysisSessionDisplay,
  dialysisSessionForAppointment,
  dialysisSessionOrderId,
  isOpenDialysisSession,
  type DialysisPerformStage,
  type DialysisSession,
} from "../fhir/dialysisResultHelpers";
import {
  DIALYSIS_TASK_STATUS_OPTIONS,
  dialysisTaskActions,
  dialysisTaskStatus,
  dialysisTaskStatusDisplay,
  type DialysisTaskStatus,
} from "../fhir/dialysisTaskHelpers";
import { activeDialysisBeds } from "../fhir/dialysisUnitHelpers";
import { orderContextSummary, orderRequester, wardOf } from "../fhir/orderHeader";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { displayName } from "../fhir/patientHelpers";
import { SETTING_OPTIONS } from "../fhir/prescriptionHelpers";
import { formatDateLabel, weekDates, weekStart } from "../fhir/scheduleHelpers";
import { useRowPictogramSources, type RowPictogramSources } from "../hooks/useRowPictogramSources";
import { addDays, shortDate, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";
import { useCurrentPractitioner } from "../api/authQueries";

// 透析一覧(部門ワークリスト)。docs/dialysis-order-design.md §5。
//
// 3 つのビューを切り替える。
// - ボード … その日のベッド × シフトの格子と、ベッドサイドのオーダー。日々の運用の起点。
// - 週     … 7 日ぶんの格子。予約の偏りと空きを見る。
// - オーダー … 基準日に効いているオーダー(リハビリ一覧の依頼ビューと同じ軸)。受付・展開・臨時予約・終了の起点。
//
// 進捗(Task)は部門の受け入れ状態で、予約を展開しても実施しても動かない(dialysisTaskHelpers.ts)。
// 実施はボードのセル(ベッドサイドは格子の下の表)から 入室 → 開始 → 終了 と進める(dialysisResultHelpers.ts)。
// 「終了」はオーダーに終了日を書き、終了日の翌日以降の予約を取り消す。

type View = "board" | "week" | "orders";

interface Performing {
  stage: DialysisPerformStage;
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  appointment?: fhir4.Appointment;
  session?: DialysisSession;
  placeLabel?: string;
}

interface Filters {
  modality: string;
  setting: string;
  status: string;
}

const emptyFilters: Filters = { modality: "", setting: "", status: "" };

export function DialysisWorklistPage() {
  const [date, setDate] = useState(today);
  const [view, setView] = useState<View>("board");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ orderId: string; appointment?: fhir4.Appointment } | null>(null);
  const [finishingId, setFinishingId] = useState<string | null>(null);
  const [performing, setPerforming] = useState<Performing | null>(null);

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const shifts = useDialysisShifts();
  const units = useDialysisUnits();
  const worklist = useDialysisWorklist(date);
  const updateStatus = useUpdateDialysisTaskStatus();
  const cancelAppointment = useCancelAppointment();
  const perform = useDialysisPerform();
  const { practitionerId, practitioner } = useCurrentPractitioner();

  const dates = useMemo(() => (view === "week" ? weekDates(weekStart(date)) : [date]), [view, date]);
  const from = dates[0];
  const to = dates[dates.length - 1];
  const board = useDialysisBoard(from, to);
  const beds = useMemo(
    () => activeDialysisBeds(units.data?.groups ?? [], units.data?.schedulesByBedId ?? new Map()),
    [units.data],
  );
  const scheduleIds = beds.flatMap((entry) => (entry.schedule?.id ? [entry.schedule.id] : []));
  const slots = useDialysisSlots(view === "orders" ? [] : scheduleIds, from, to);
  const sessions = useDialysisSessions(view === "orders" ? "" : from, to);

  const allRows = useMemo(() => worklist.data?.rows ?? [], [worklist.data]);
  const rows = useMemo(() => allRows.filter((row) => matchesFilters(row, filters)), [allRows, filters]);
  const patientIds = useMemo(() => rows.flatMap((row) => (row.patient?.id ? [row.patient.id] : [])), [rows]);
  const pictograms = useRowPictogramSources(patientIds);
  const drawer = useRowDrawer(view);
  const selectedRow = view === "orders" ? rows.find((row) => row.patient?.id && row.order.id === drawer.selectedKey) : undefined;

  const boardEntries: DialysisBoardEntry[] = useMemo(
    () =>
      (board.data?.appointments ?? []).map((appointment) => {
        const patientId = appointment.participant
          ?.find((p) => p.actor?.reference?.startsWith("Patient/"))
          ?.actor?.reference?.split("/")
          .pop();
        const orderId = appointmentOrderId(appointment);
        return {
          appointment,
          patient: patientId ? board.data?.patientsById.get(patientId) : undefined,
          order: board.data?.ordersById.get(orderId),
          session: dialysisSessionForAppointment(
            sessions.data?.sessions ?? [],
            appointment,
            orderId,
            dialysisAppointmentDate(appointment),
          ),
        };
      }),
    [board.data, sessions.data],
  );

  // ベッドサイドのオーダーは格子に乗らない(予約を作らない)ので、その日に効いているものを下に並べる。
  const bedsideRows = allRows.filter(
    (row) => summarizeDialysisOrder(row.order).bedside && ["requested", "accepted"].includes(dialysisTaskStatus(row.task)),
  );

  // 一覧に無いオーダー(週の後半に始まるオーダーの予約など)も、ボードから開けるように予約の include から引く。
  function orderOf(orderId: string | null | undefined): { order: fhir4.ServiceRequest; patient?: fhir4.Patient } | undefined {
    const row = allRows.find((r) => r.order.id === orderId);
    if (row) return row;
    const order = orderId ? board.data?.ordersById.get(orderId) : undefined;
    return order ? { order, patient: boardEntries.find((e) => e.order?.id === orderId)?.patient } : undefined;
  }

  const viewing = orderOf(viewingId);
  const expanding = allRows.find((row) => row.order.id === expandingId);
  const bookingRow = orderOf(booking?.orderId);
  const finishing = allRows.find((row) => row.order.id === finishingId);

  function handleChangeStatus(row: DialysisWorklistRow, status: DialysisTaskStatus) {
    if (status === "completed") {
      setFinishingId(row.order.id ?? null);
      return;
    }
    updateStatus.mutate({ order: row.order, task: row.task, status });
  }

  function startPerform(
    action: DialysisPerformAction,
    target: Omit<Performing, "stage">,
  ) {
    if (action === "start" || action === "finish") {
      setPerforming({ stage: action, ...target });
      return;
    }
    const { order, appointment, session } = target;
    if (action === "arrive") {
      const performer = practitionerId
        ? { id: practitionerId, name: practitioner ? practitionerDisplayName(practitioner) : "" }
        : null;
      perform.mutate(buildDialysisArrivalBundle({ order, appointment, performer }));
      return;
    }
    if (!session || !window.confirm("この回の実施記録を取り消します。よろしいですか?")) return;
    perform.mutate(buildDialysisPerformDeleteBundle(session, appointment));
  }

  const boardActions = {
    pending: cancelAppointment.isPending || perform.isPending,
    onPerform: (entry: DialysisBoardEntry, action: DialysisPerformAction, placeLabel: string) => {
      if (!entry.order) return;
      startPerform(action, {
        order: entry.order,
        patient: entry.patient,
        appointment: entry.appointment,
        session: entry.session,
        placeLabel,
      });
    },
    onView: (entry: DialysisBoardEntry) => setViewingId(entry.order?.id ?? null),
    onReschedule: (entry: DialysisBoardEntry) =>
      setBooking({ orderId: appointmentOrderId(entry.appointment), appointment: entry.appointment }),
    onCancel: (entry: DialysisBoardEntry) => {
      if (!window.confirm("この予約を取り消します。よろしいですか?")) return;
      cancelAppointment.mutate(entry.appointment);
    },
  };

  function rowActions(row: DialysisWorklistRow) {
    return {
      pending: updateStatus.isPending,
      onView: () => setViewingId(row.order.id ?? null),
      onExpand: () => setExpandingId(row.order.id ?? null),
      onBook: () => setBooking({ orderId: row.order.id ?? "" }),
      onChangeStatus: (status: DialysisTaskStatus) => handleChangeStatus(row, status),
    };
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>透析一覧</h1>
        <div className="page__header-actions">
          <Link to="/dialysis-unit" className="button">
            透析室の設定
          </Link>
        </div>
      </div>

      <div className="order-select__tabs" role="tablist">
        {(
          [
            ["board", "ボード"],
            ["week", "週"],
            ["orders", `オーダー${allRows.length > 0 ? ` (${allRows.length})` : ""}`],
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

      <FilterForm
        date={date}
        view={view}
        filters={filters}
        onDateChange={(value) => value && setDate(value)}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={units.error} />
      <ErrorBanner error={board.error} />
      <ErrorBanner error={slots.error} />
      <ErrorBanner error={updateStatus.error} />
      <ErrorBanner error={cancelAppointment.error} />
      <ErrorBanner error={sessions.error} />
      <ErrorBanner error={perform.error} />

      {view === "orders" ? (
        <>
          <TruncatedNotice show={worklist.data?.truncated} />
          {worklist.isLoading ? (
            <p>読み込み中...</p>
          ) : (
            <OrderTable
              rows={rows}
              shifts={shifts}
              allCount={allRows.length}
              date={date}
              pictograms={pictograms}
              rowProps={(row) => drawer.rowProps(row.patient?.id && row.order.id)}
              actions={rowActions}
            />
          )}
        </>
      ) : (
        <>
          <TruncatedNotice show={board.data?.truncated || sessions.data?.truncated} />
          {board.isLoading || units.isLoading ? (
            <p>読み込み中...</p>
          ) : (
            <DialysisBoard
              dates={dates}
              beds={beds}
              shifts={shifts}
              entries={boardEntries}
              slots={slots.data ?? []}
              {...boardActions}
            />
          )}
          {view === "board" && (
            <BedsideTable
              rows={bedsideRows}
              date={date}
              sessions={sessions.data?.sessions ?? []}
              pending={perform.isPending}
              onView={(row) => setViewingId(row.order.id ?? null)}
              onPerform={(row, action, session) =>
                startPerform(action, { order: row.order, patient: row.patient, session, placeLabel: "ベッドサイド" })
              }
            />
          )}
        </>
      )}

      {selectedRow?.patient?.id && (
        <PatientProfileDrawer
          patientId={selectedRow.patient.id}
          patient={selectedRow.patient}
          actions={
            <>
              <OrderRowButtons row={selectedRow} {...rowActions(selectedRow)} />
              <OrderMenuItems row={selectedRow} {...rowActions(selectedRow)} />
            </>
          }
          onClose={drawer.close}
        />
      )}

      {viewing && (
        <Modal
          title={`透析内容 - ${viewing.patient ? displayName(viewing.patient) : ""}`}
          onClose={() => setViewingId(null)}
          className="modal--wide"
        >
          <DialysisOrderDetailPanel serviceRequest={viewing.order} />
        </Modal>
      )}

      {expanding && (
        <DialysisExpandModal order={expanding.order} patient={expanding.patient} onClose={() => setExpandingId(null)} />
      )}

      {bookingRow && booking && (
        <DialysisBookModal
          order={bookingRow.order}
          patient={bookingRow.patient}
          appointment={booking.appointment}
          defaultDate={latestDate(date, summarizeDialysisOrder(bookingRow.order).startDate)}
          onClose={() => setBooking(null)}
        />
      )}

      {performing && (
        <DialysisPerformModal
          stage={performing.stage}
          order={performing.order}
          patient={performing.patient}
          appointment={performing.appointment}
          session={performing.session}
          placeLabel={performing.placeLabel}
          onClose={() => setPerforming(null)}
        />
      )}

      {finishing && (
        <DialysisFinishModal
          row={finishing}
          defaultEndDate={date}
          pending={updateStatus.isPending}
          onSubmit={(endDate) =>
            updateStatus.mutate(
              { order: finishing.order, task: finishing.task, status: "completed", endDate },
              { onSuccess: () => setFinishingId(null) },
            )
          }
          onClose={() => setFinishingId(null)}
        />
      )}
    </div>
  );
}

function latestDate(a: string, b: string): string {
  return a > b ? a : b;
}

function matchesFilters(row: DialysisWorklistRow, filters: Filters): boolean {
  const summary = summarizeDialysisOrder(row.order);
  if (filters.modality && summary.modality !== filters.modality) return false;
  if (filters.setting && SETTING_OPTIONS.find((o) => o.code === filters.setting)?.display !== summary.settingDisplay) {
    return false;
  }
  if (filters.status && dialysisTaskStatus(row.task) !== filters.status) return false;
  return true;
}

function FilterForm({
  date,
  view,
  filters,
  onDateChange,
  onChange,
}: {
  date: string;
  view: View;
  filters: Filters;
  onDateChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }
  const weekFrom = weekStart(date);

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        {view === "week" ? "週" : "基準日"}
        {view === "week" ? (
          <div className="inpatient__date">
            <button type="button" onClick={() => onDateChange(addDays(date, -7))} aria-label="前の週">
              &lt;
            </button>
            <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
            <button type="button" onClick={() => onDateChange(addDays(date, 7))} aria-label="次の週">
              &gt;
            </button>
            <button type="button" onClick={() => onDateChange(today())}>
              今週
            </button>
            <span className="order-select__muted">
              {formatDateLabel(weekFrom)}〜{formatDateLabel(addDays(weekFrom, 6))}
            </span>
          </div>
        ) : (
          <DateStepper value={date} onChange={onDateChange} />
        )}
      </label>
      {view === "orders" && (
        <>
          <label>
            浄化方法
            <select value={filters.modality} onChange={(e) => onChange({ ...filters, modality: e.target.value })}>
              <option value="">すべて</option>
              {DIALYSIS_MODALITY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            入外区分
            <select value={filters.setting} onChange={(e) => onChange({ ...filters, setting: e.target.value })}>
              <option value="">すべて</option>
              {SETTING_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            ステータス
            <select value={filters.status} onChange={(e) => onChange({ ...filters, status: e.target.value })}>
              <option value="">すべて</option>
              {DIALYSIS_TASK_STATUS_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <div className="patient-search-form__actions">
            <button type="button" onClick={() => onChange(emptyFilters)}>
              クリア
            </button>
          </div>
        </>
      )}
    </form>
  );
}

interface RowActions {
  pending: boolean;
  onView: () => void;
  onExpand: () => void;
  onBook: () => void;
  onChangeStatus: (status: DialysisTaskStatus) => void;
}

function OrderTable({
  rows,
  shifts,
  allCount,
  date,
  pictograms,
  rowProps,
  actions,
}: {
  rows: DialysisWorklistRow[];
  shifts: DialysisShift[];
  allCount: number;
  date: string;
  pictograms: RowPictogramSources;
  rowProps: (row: DialysisWorklistRow) => ComponentProps<"tr">;
  actions: (row: DialysisWorklistRow) => RowActions;
}) {
  const returnLinkState = useReturnLinkState();
  return (
    <>
      <div className="lab-worklist-wrap sticky-table-wrap">
        <table className="lab-worklist sticky-table">
          <thead>
            <tr>
              <th className="sticky-table__fix-1">患者番号</th>
              <th className="sticky-table__fix-2">患者氏名</th>
              <PatientProfileHeadCells />
              <th className="lab-worklist__compact">浄化方法</th>
              <th className="lab-worklist__compact">曜日・シフト</th>
              <th className="lab-worklist__compact">期間</th>
              <th className="lab-worklist__compact">次回予約</th>
              <th className="lab-worklist__compact">予約</th>
              <th className="lab-worklist__compact">入外</th>
              <th className="lab-worklist__compact">病棟</th>
              <th>依頼科 | 依頼医師</th>
              <th className="lab-worklist__compact">ステータス</th>
              <th className="lab-worklist__actions sticky-table__fix-actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { order, patient } = row;
              const summary = summarizeDialysisOrder(order);
              const status = dialysisTaskStatus(row.task);
              const next = row.appointments[0];
              const last = row.appointments[row.appointments.length - 1];
              return (
                <tr key={order.id} {...rowProps(row)}>
                  <td className="sticky-table__fix-1">{patient?.identifier?.[0]?.value ?? "-"}</td>
                  <td className="sticky-table__fix-2">
                    {patient ? (
                      <>
                        <Link to={`/patients/${patient.id}/karte`} state={returnLinkState}>
                          {displayName(patient)}
                        </Link>
                        <PatientKana patient={patient} />
                        <RowPictograms patientId={patient.id ?? ""} {...pictograms} />
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <PatientProfileCells patient={patient} />
                  <td className="lab-worklist__compact">{summary.modalityShort || "-"}</td>
                  <td className="lab-worklist__compact">{summary.scheduleLabel || "-"}</td>
                  <td className="lab-worklist__compact">{summary.periodLabel || "-"}</td>
                  <td className="lab-worklist__compact">
                    {summary.bedside ? (
                      "-"
                    ) : next ? (
                      [
                        shortDate(dialysisAppointmentDate(next)),
                        dialysisAppointmentShift(next, shifts)?.label,
                        next.description,
                      ]
                        .filter(Boolean)
                        .join(" ")
                    ) : (
                      <span className="order-select__muted">未定</span>
                    )}
                  </td>
                  {/* 展開済みの予約の残りと、どこまで取れているか。展開し忘れに気づけるようにする。 */}
                  <td className="lab-worklist__compact">
                    {summary.bedside
                      ? "-"
                      : row.appointments.length > 0
                        ? `${row.appointments.length}件(〜${shortDate(dialysisAppointmentDate(last))})`
                        : "0件"}
                  </td>
                  <td className="lab-worklist__compact">{summary.settingDisplay || "-"}</td>
                  <td className="lab-worklist__compact">{wardOf(order).wardName || "-"}</td>
                  <td>{orderContextSummary(orderRequester(order)) || "-"}</td>
                  <td className="lab-worklist__compact">
                    <span className={`lab-worklist__status lab-worklist__status--${status}`}>
                      {dialysisTaskStatusDisplay(status)}
                    </span>
                  </td>
                  <td className="lab-worklist__actions sticky-table__fix-actions">
                    <OrderRowButtons row={row} {...actions(row)} />
                    {secondaryActions(row).length > 0 && (
                      <RowMenu label="この透析の操作" escapesClipping>
                        <OrderMenuItems row={row} {...actions(row)} />
                      </RowMenu>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={15} className="master-search__empty">
                  {allCount === 0 ? `${date} に効いている透析オーダーはありません` : "絞り込みに該当する透析がありません"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
    </>
  );
}

/** 行の操作列に直接並べるボタン。ドロワーにも同じものを並べる。 */
function OrderRowButtons({ row, pending, onView, onExpand, onBook, onChangeStatus }: { row: DialysisWorklistRow } & RowActions) {
  const status = dialysisTaskStatus(row.task);
  const bedside = summarizeDialysisOrder(row.order).bedside;
  return (
    <>
      {dialysisTaskActions(status)
        .filter((action) => !action.secondary)
        .map((action) => (
          <button key={action.next} type="button" disabled={pending} onClick={() => onChangeStatus(action.next)}>
            {action.label}
          </button>
        ))}
      {/* 予約は受け入れ済みのオーダーにだけ取る。ベッドサイドは予約を作らない。 */}
      {status === "accepted" && !bedside && (
        <>
          <button type="button" onClick={onExpand}>
            展開
          </button>
          <button type="button" onClick={onBook}>
            臨時
          </button>
        </>
      )}
      <button type="button" onClick={onView}>
        表示
      </button>
    </>
  );
}

function secondaryActions(row: DialysisWorklistRow) {
  return dialysisTaskActions(dialysisTaskStatus(row.task)).filter((action) => action.secondary);
}

function OrderMenuItems({ row, pending, onChangeStatus }: { row: DialysisWorklistRow } & RowActions) {
  return (
    <>
      {secondaryActions(row).map((action) => (
        <button
          key={action.next}
          type="button"
          className={`row-menu__item${action.next === "cancelled" ? " row-menu__item--danger" : ""}`}
          disabled={pending}
          onClick={() => onChangeStatus(action.next)}
        >
          {action.label}
        </button>
      ))}
    </>
  );
}

/**
 * ベッドサイドで行うオーダー(急性血液浄化など)。透析室のベッドを取らないので格子の下に並べ、
 * 予約なしでここから実施する(CHDF は日をまたいで続くので、終わっていない回は日付を問わず出す)。
 */
function BedsideTable({
  rows,
  date,
  sessions,
  pending,
  onView,
  onPerform,
}: {
  rows: DialysisWorklistRow[];
  date: string;
  sessions: DialysisSession[];
  pending: boolean;
  onView: (row: DialysisWorklistRow) => void;
  onPerform: (row: DialysisWorklistRow, action: DialysisPerformAction, session?: DialysisSession) => void;
}) {
  const returnLinkState = useReturnLinkState();
  if (rows.length === 0) return null;
  return (
    <div className="dialysis-board__bedside">
      <h3 className="dialysis-board__subtitle">ベッドサイド</h3>
      <table className="master-search__table">
        <thead>
          <tr>
            <th>患者氏名</th>
            <th className="rad-item__compact">浄化方法</th>
            <th className="rad-item__compact">期間</th>
            <th className="rad-item__compact">病棟</th>
            <th>条件</th>
            <th>実施</th>
            <th className="rad-item__compact">ステータス</th>
            <th className="rad-item__compact"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const summary = summarizeDialysisOrder(row.order);
            const status = dialysisTaskStatus(row.task);
            const own = sessions.filter(
              (session) => dialysisSessionOrderId(session) === row.order.id && !dialysisSessionAppointmentId(session),
            );
            const open = own.find(isOpenDialysisSession);
            const done = own.filter((session) => !isOpenDialysisSession(session) && dialysisSessionDay(session) === date);
            return (
              <tr key={row.order.id}>
                <td>
                  {row.patient ? (
                    <Link to={`/patients/${row.patient.id}/karte`} state={returnLinkState}>
                      {displayName(row.patient)}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="rad-item__compact">{summary.modalityShort}</td>
                <td className="rad-item__compact">{summary.periodLabel}</td>
                <td className="rad-item__compact">{wardOf(row.order).wardName || "-"}</td>
                <td>{summary.conditionLabel || "-"}</td>
                <td>
                  {[open, ...done].flatMap((session) => {
                    if (!session) return [];
                    const display = dialysisSessionDisplay(session);
                    return [
                      <div key={display.id}>
                        {[display.statusLabel, display.timeLabel, display.summary].filter(Boolean).join(" ")}
                      </div>,
                    ];
                  })}
                  {!open && done.length === 0 && "-"}
                </td>
                <td className="rad-item__compact">
                  <span className={`lab-worklist__status lab-worklist__status--${status}`}>
                    {dialysisTaskStatusDisplay(status)}
                  </span>
                </td>
                <td className="rad-item__compact dialysis-board__bedside-actions">
                  {status === "accepted" && (
                    <>
                      {open?.hub.status === "in-progress" ? (
                        <button
                          type="button"
                          className="rp-card__compact-button"
                          disabled={pending}
                          onClick={() => onPerform(row, "finish", open)}
                        >
                          終了
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rp-card__compact-button"
                          disabled={pending}
                          onClick={() => onPerform(row, "start", open)}
                        >
                          開始
                        </button>
                      )}
                      {!open && (
                        <button
                          type="button"
                          className="rp-card__compact-button"
                          disabled={pending}
                          onClick={() => onPerform(row, "finish")}
                        >
                          一括記録
                        </button>
                      )}
                      {open && (
                        <button
                          type="button"
                          className="rp-card__compact-button"
                          disabled={pending}
                          onClick={() => onPerform(row, "cancel-perform", open)}
                        >
                          実施取消
                        </button>
                      )}
                    </>
                  )}
                  <button type="button" className="rp-card__compact-button" onClick={() => onView(row)}>
                    表示
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 終了(期間の打ち切り)。Task を completed にし、オーダーに終了日を書き、終了日の翌日以降の予約を取り消す。
 */
function DialysisFinishModal({
  row,
  defaultEndDate,
  pending,
  onSubmit,
  onClose,
}: {
  row: DialysisWorklistRow;
  defaultEndDate: string;
  pending: boolean;
  onSubmit: (endDate: string) => void;
  onClose: () => void;
}) {
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [error, setError] = useState("");
  const summary = summarizeDialysisOrder(row.order);
  const cancelCount = row.appointments.filter((a) => dialysisAppointmentDate(a) > endDate).length;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!endDate) {
      setError("終了日を入れてください。");
      return;
    }
    if (endDate < summary.startDate) {
      setError("終了日は開始日と同じか、それより後にしてください。");
      return;
    }
    setError("");
    onSubmit(endDate);
  }

  return (
    <Modal title={`透析の終了${row.patient ? ` - ${displayName(row.patient)}` : ""}`} onClose={onClose}>
      <form className="walk-in" onSubmit={handleSubmit}>
        {error && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{error}</p>
          </div>
        )}
        <p className="appointment-panel__current">
          {[summary.modalityShort, summary.scheduleLabel, summary.periodLabel].filter(Boolean).join(" / ")}
        </p>
        <div className="walk-in__fields">
          <label>
            終了日
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </label>
        </div>
        {cancelCount > 0 && <p className="order-select__muted">取り消す予約: {cancelCount} 件</p>}
        <div className="walk-in__actions">
          <button type="submit" disabled={pending}>
            {pending ? "終了中..." : "終了"}
          </button>
          <button type="button" onClick={onClose} disabled={pending}>
            キャンセル
          </button>
        </div>
      </form>
    </Modal>
  );
}
