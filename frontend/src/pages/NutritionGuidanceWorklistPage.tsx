import { today } from "../lib/dates";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import {
  useCancelAppointment,
  useDeleteNutritionGuidancePerform,
  useNutritionGuidanceWorklist,
  useSelfDepartments,
  useUpdateNutritionGuidanceTaskStatus,
  type NutritionGuidanceWorklistRow,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { RowMenu } from "../components/RowMenu";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { NutritionGuidanceBookModal } from "../components/NutritionGuidanceBookModal";
import { NutritionGuidanceOrderDetailPanel } from "../components/NutritionGuidanceOrderDetailPanel";
import { NutritionGuidancePerformModal } from "../components/NutritionGuidancePerformModal";
import { appointmentTimeLabel, appointmentScheduleLabel } from "../fhir/appointmentHelpers";
import { displayName } from "../fhir/patientHelpers";
import {
  SETTING_OPTIONS,
  orderContextSummary,
  prescriptionRequester,
  wardOf,
} from "../fhir/prescriptionHelpers";
import {
  GUIDANCE_FORMAT_OPTIONS,
  summarizeNutritionGuidanceOrder,
} from "../fhir/nutritionGuidanceOrderHelpers";
import {
  NUTRITION_GUIDANCE_TASK_STATUS_OPTIONS,
  nutritionGuidanceTaskActions,
  nutritionGuidanceTaskStatus,
  nutritionGuidanceTaskStatusDisplay,
  type NutritionGuidanceTaskStatus,
} from "../fhir/nutritionGuidanceTaskHelpers";

// 栄養指導一覧(部門ワークリスト)。
//
// **軸はリハビリ一覧と同じ**(docs/nutrition-guidance-order-design.md §1)。検査・処置は
// 「その日に実施予定のオーダー」を並べるが、栄養指導は 1 つのオーダーで初回・継続と
// 指導が続くので、基準日に**効いている**(始まっていて、まだ終わっていない)オーダーを
// 並べる。同じ患者の同じオーダーがこの一覧に出続け、実施だけが積み上がっていく。
//
// そのため 2 つのビューを切り替えられるようにしてある。
// - 依頼 … 基準日に効いているオーダー全部。受付・終了・次回予約の起点。
// - 予約 … その日に予約が入っている患者だけを時刻順に。日々の実施の起点。
//
// 進捗(Task)は「部門の受け入れ状態」で、実施しても動かない。実施は Procedure が
// 積み上がるだけ(§3)。そのため行のボタンは他部門と違い、「実施」を押しても行の
// ステータスは実施中のまま変わらない。
//
// 「終了」はオーダーにも終了日を書く。書かないと status=active のまま
// `occurrence=le{基準日}` に永久にヒットし、この一覧が際限なく重くなる。

type View = "orders" | "appointments";

interface Filters {
  format: string;
  setting: string;
  wardId: string;
  departmentId: string;
  status: string;
}

const emptyFilters: Filters = {
  format: "",
  setting: "",
  wardId: "",
  departmentId: "",
  status: "",
};

export function NutritionGuidanceWorklistPage() {
  const [date, setDate] = useState(today);
  const [view, setView] = useState<View>("orders");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 開いている対象は行そのものではなく id で覚えておき、読み直しのたびに引き直す。
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [performing, setPerforming] = useState<{ orderId: string; time?: string } | null>(null);
  const [booking, setBooking] = useState<{ orderId: string; appointmentId?: string } | null>(null);
  // 終了は終了日も書くので、確認ではなく日付を入れるモーダルにする。
  const [finishingId, setFinishingId] = useState<string | null>(null);

  // 列が多いのでこの画面だけ幅を広げる(リハビリ・輸血一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useNutritionGuidanceWorklist(date);
  const departments = useSelfDepartments();
  const updateStatus = useUpdateNutritionGuidanceTaskStatus();
  const deletePerform = useDeleteNutritionGuidancePerform();
  const cancelAppointment = useCancelAppointment();

  const allRows = useMemo(() => worklist.data?.rows ?? [], [worklist.data]);
  const rows = useMemo(
    () => allRows.filter((row) => matchesFilters(row, filters)),
    [allRows, filters],
  );

  // 「予約」ビューは、基準日に予約が入っている行だけを予約時刻順に並べる。
  // 1 オーダーにその日 2 枠入ることもあるので、予約 1 件 = 1 行に展開する。
  const appointmentRows = useMemo(() => {
    const entries = rows.flatMap((row) =>
      row.appointments
        .filter((appointment) => (appointment.start ?? "").slice(0, 10) === date)
        .map((appointment) => ({ row, appointment })),
    );
    return entries.sort((a, b) =>
      (a.appointment.start ?? "").localeCompare(b.appointment.start ?? ""),
    );
  }, [rows, date]);

  const viewing = allRows.find((row) => row.order.id === viewingId);
  const performingRow = allRows.find((row) => row.order.id === performing?.orderId);
  const bookingRow = allRows.find((row) => row.order.id === booking?.orderId);
  const finishingRow = allRows.find((row) => row.order.id === finishingId);
  const bookingAppointment = booking?.appointmentId
    ? bookingRow?.appointments.find((a) => a.id === booking.appointmentId)
    : undefined;

  // 病棟の選択肢は読み込んだぶんのオーダーから拾う(リハビリ一覧と同じ考え方)。
  const wardOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of allRows) {
      const ward = wardOf(row.order);
      if (ward.wardId && !byId.has(ward.wardId)) {
        byId.set(ward.wardId, ward.wardName || ward.wardId);
      }
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [allRows]);

  function handleDateChange(value: string) {
    // 日付を空にはさせない(空で検索すると全期間になってしまう)。
    if (value) setDate(value);
  }

  /**
   * 進捗の変更。終了だけはオーダーにも終了日を書くので、いつまでの指導だったかを
   * 入れさせるモーダルに回す(§3)。
   */
  function handleChangeStatus(
    row: NutritionGuidanceWorklistRow,
    status: NutritionGuidanceTaskStatus,
  ) {
    if (status === "completed") {
      setFinishingId(row.order.id ?? null);
      return;
    }
    updateStatus.mutate({ order: row.order, task: row.task, status });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>栄養指導一覧</h1>
      </div>

      {/* 2 つのビューは絞り込みではなく見る軸そのものの切り替えなので、
          絞り込み欄ではなくタブに出す(リハビリ一覧と同じ)。 */}
      <div className="order-select__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "orders"}
          className={view === "orders" ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setView("orders")}
        >
          依頼
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "appointments"}
          className={view === "appointments" ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setView("appointments")}
        >
          予約{appointmentRows.length > 0 && ` (${appointmentRows.length})`}
        </button>
      </div>

      <FilterForm
        date={date}
        filters={filters}
        wards={wardOptions}
        departments={departments.departments}
        onDateChange={handleDateChange}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={updateStatus.error} />
      <ErrorBanner error={deletePerform.error} />
      <ErrorBanner error={cancelAppointment.error} />

      {worklist.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          この日のオーダーが多いため、一部のみ表示しています。
        </p>
      )}

      {worklist.isLoading ? (
        <p>読み込み中...</p>
      ) : view === "orders" ? (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  {/* 横に送っても「誰の栄養指導か」は残す(左 2 列を固定する)。 */}
                  <th className="sticky-table__fix-1">患者番号</th>
                  <th className="sticky-table__fix-2">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="lab-worklist__compact">形態</th>
                  <th className="lab-worklist__compact">対象疾患</th>
                  <th className="lab-worklist__compact">指示食種</th>
                  <th className="lab-worklist__compact">期間</th>
                  <th className="lab-worklist__compact">本日</th>
                  <th className="lab-worklist__compact">次回予約</th>
                  <th className="lab-worklist__compact">入外</th>
                  <th className="lab-worklist__compact">病棟</th>
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
                    date={date}
                    pending={updateStatus.isPending}
                    onView={() => setViewingId(row.order.id ?? null)}
                    onPerform={() => setPerforming({ orderId: row.order.id ?? "" })}
                    onBook={() => setBooking({ orderId: row.order.id ?? "" })}
                    onChangeStatus={(status) => handleChangeStatus(row, status)}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={15} className="master-search__empty">
                      {allRows.length === 0
                        ? "この日に実施中の栄養指導オーダーはありません"
                        : "絞り込みに該当する栄養指導がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="sticky-table__fix-1">時刻</th>
                  <th className="sticky-table__fix-2">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="lab-worklist__compact">枠</th>
                  <th className="lab-worklist__compact">形態</th>
                  <th className="lab-worklist__compact">対象疾患</th>
                  <th className="lab-worklist__compact">本日</th>
                  <th className="lab-worklist__compact">ステータス</th>
                  <th className="lab-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {appointmentRows.map(({ row, appointment }) => (
                  <AppointmentRow
                    key={appointment.id}
                    row={row}
                    appointment={appointment}
                    pending={cancelAppointment.isPending}
                    onView={() => setViewingId(row.order.id ?? null)}
                    onPerform={() =>
                      setPerforming({
                        orderId: row.order.id ?? "",
                        // 予約の時刻を実施時刻の初期値にする。
                        time: (appointment.start ?? "").slice(11, 16),
                      })
                    }
                    onReschedule={() =>
                      setBooking({ orderId: row.order.id ?? "", appointmentId: appointment.id })
                    }
                    onCancel={() => {
                      if (!window.confirm("この予約を取り消します。よろしいですか?")) return;
                      cancelAppointment.mutate(appointment);
                    }}
                  />
                ))}
                {appointmentRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="master-search__empty">
                      この日の栄養指導予約はありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{appointmentRows.length} 件</p>
        </>
      )}

      {viewing && (
        <Modal
          title={`栄養指導内容 - ${viewing.patient ? displayName(viewing.patient) : ""}`}
          onClose={() => setViewingId(null)}
          className="modal--wide"
        >
          {/* 一覧から開いたときだけ実施の取消も出す(カルテの詳細では消させない)。
              実施履歴はその日ぶんしか読み込んでいないので、全期間は詳細で読み直す。 */}
          <NutritionGuidanceOrderDetailPanel
            serviceRequest={viewing.order}
            performs={viewing.todayPerforms}
            onDeletePerform={(perform) => {
              if (!window.confirm("この実施記録を取り消します。よろしいですか?")) return;
              deletePerform.mutate({
                id: perform.id,
                recordResponseId: perform.recordResponseId,
              });
            }}
            deletingPerformId={
              deletePerform.isPending ? deletePerform.variables?.id : undefined
            }
          />
          <p className="order-select__muted">
            実施履歴は {date} のぶんだけを表示しています(全期間はカルテの詳細で確認できます)。
          </p>
        </Modal>
      )}

      {performingRow && (
        <NutritionGuidancePerformModal
          order={performingRow.order}
          patientId={performingRow.patient?.id ?? ""}
          patientName={performingRow.patient ? displayName(performingRow.patient) : undefined}
          defaultDate={date}
          defaultTime={performing?.time}
          onClose={() => setPerforming(null)}
        />
      )}

      {finishingRow && (
        <NutritionGuidanceFinishModal
          row={finishingRow}
          defaultEndDate={date}
          pending={updateStatus.isPending}
          onSubmit={(endDate) =>
            updateStatus.mutate(
              {
                order: finishingRow.order,
                task: finishingRow.task,
                status: "completed",
                endDate,
              },
              { onSuccess: () => setFinishingId(null) },
            )
          }
          onClose={() => setFinishingId(null)}
        />
      )}

      {bookingRow && (
        <NutritionGuidanceBookModal
          order={bookingRow.order}
          patient={bookingRow.patient}
          appointment={bookingAppointment}
          onClose={() => setBooking(null)}
        />
      )}
    </div>
  );
}

function matchesFilters(row: NutritionGuidanceWorklistRow, filters: Filters): boolean {
  const summary = summarizeNutritionGuidanceOrder(row.order);
  if (filters.format && summary.format !== filters.format) return false;

  // 入外区分は表示名ではなくコードで持っているので、選択肢のコードと突き合わせる。
  if (
    filters.setting &&
    SETTING_OPTIONS.find((o) => o.code === filters.setting)?.display !== summary.settingDisplay
  ) {
    return false;
  }

  // 病棟はオーダー登録時に焼き付けたもの。外来オーダーと、焼き付ける前に出した
  // オーダーは病棟を持たないので、病棟で絞ると消える。
  if (filters.wardId && wardOf(row.order).wardId !== filters.wardId) return false;

  const requester = prescriptionRequester(row.order);
  if (filters.departmentId && requester.departmentId !== filters.departmentId) return false;

  if (filters.status && nutritionGuidanceTaskStatus(row.task) !== filters.status) return false;

  return true;
}

interface FilterFormProps {
  date: string;
  filters: Filters;
  wards: { id: string; name: string }[];
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({
  date,
  filters,
  wards,
  departments,
  onDateChange,
  onChange,
}: FilterFormProps) {
  // 絞り込みは選んだ瞬間に効かせるので、Enter での送信は何もしない。
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        基準日
        <input type="date" value={date} required onChange={(e) => onDateChange(e.target.value)} />
      </label>
      <label>
        指導形態
        <select
          value={filters.format}
          onChange={(e) => onChange({ ...filters, format: e.target.value })}
        >
          <option value="">すべて</option>
          {GUIDANCE_FORMAT_OPTIONS.map((option) => (
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
          onChange={(e) => onChange({ ...filters, setting: e.target.value })}
        >
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
        <select
          value={filters.wardId}
          onChange={(e) => onChange({ ...filters, wardId: e.target.value })}
        >
          <option value="">すべて</option>
          {wards.map((ward) => (
            <option key={ward.id} value={ward.id}>
              {ward.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        診療科
        <select
          value={filters.departmentId}
          onChange={(e) => onChange({ ...filters, departmentId: e.target.value })}
        >
          <option value="">すべて</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        ステータス
        <select
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
        >
          <option value="">すべて</option>
          {NUTRITION_GUIDANCE_TASK_STATUS_OPTIONS.map((option) => (
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
    </form>
  );
}

/** その日の実施のまとめ(「30分 初回」)。未実施なら空。 */
function todaySummary(row: NutritionGuidanceWorklistRow): string {
  if (row.todayPerforms.length === 0) return "";
  const minutes = row.todayPerforms.reduce((sum, perform) => sum + (perform.minutes ?? 0), 0);
  const types = Array.from(
    new Set(row.todayPerforms.map((perform) => perform.sessionTypeShort).filter(Boolean)),
  );
  return [minutes ? `${minutes}分` : "", types.join("・")].filter(Boolean).join(" ");
}

function OrderRow({
  row,
  date,
  pending,
  onView,
  onPerform,
  onBook,
  onChangeStatus,
}: {
  row: NutritionGuidanceWorklistRow;
  date: string;
  pending: boolean;
  onView: () => void;
  onPerform: () => void;
  onBook: () => void;
  onChangeStatus: (status: NutritionGuidanceTaskStatus) => void;
}) {
  // カルテの「戻る」でこの一覧に戻れるように遷移元を渡す。
  const returnLinkState = useReturnLinkState();
  const { order, patient } = row;
  const summary = summarizeNutritionGuidanceOrder(order);
  const requester = prescriptionRequester(order);
  const status = nutritionGuidanceTaskStatus(row.task);
  const actions = nutritionGuidanceTaskActions(status);
  const secondaryActions = actions.filter((action) => action.secondary);
  const performed = todaySummary(row);
  // 基準日以降で最初の予約。取れていない行は次回が決まっていない。
  const next = row.appointments.find((a) => (a.start ?? "") >= date);

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
      <td className="lab-worklist__compact">{summary.formatShort || "-"}</td>
      <td className="lab-worklist__compact">{summary.targetDisease || "-"}</td>
      <td className="lab-worklist__compact">{summary.targetDiet || "-"}</td>
      <td className="lab-worklist__compact">{summary.periodLabel || "-"}</td>
      {/* その日にもう指導したか。期間型なので「実施済かどうか」は日ごとに見る。 */}
      <td className="lab-worklist__compact">
        {performed || <span className="order-select__muted">未実施</span>}
      </td>
      <td className="lab-worklist__compact">
        {next ? (
          `${(next.start ?? "").slice(5, 10).replace("-", "/")} ${appointmentTimeLabel(next)}`
        ) : (
          <span className="order-select__muted">未定</span>
        )}
      </td>
      <td className="lab-worklist__compact">{summary.settingDisplay || "-"}</td>
      {/* オーダー登録時の入院病棟。外来オーダーと、焼き付ける前のオーダーは "-"。 */}
      <td className="lab-worklist__compact">{wardOf(order).wardName || "-"}</td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {nutritionGuidanceTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="lab-worklist__actions sticky-table__fix-actions">
        {actions
          .filter((action) => !action.secondary)
          .map((action) => (
            <button
              key={action.next}
              type="button"
              disabled={pending}
              onClick={() => onChangeStatus(action.next)}
            >
              {action.label}
            </button>
          ))}
        {/* 実施と次回予約は受け入れ済のオーダーにだけ出す。実施は Task を動かさず
            Procedure を足すだけなので、押しても行のステータスは実施中のまま。 */}
        {status === "accepted" && (
          <>
            <button type="button" onClick={onPerform}>
              実施
            </button>
            <button type="button" onClick={onBook}>
              次回予約
            </button>
          </>
        )}
        <button type="button" onClick={onView}>
          表示
        </button>
        {/* 終了・取消・中止は押し間違えると期間や進捗が動くので一段畳む。 */}
        {secondaryActions.length > 0 && (
          <RowMenu label="この栄養指導の操作" escapesClipping>
            {secondaryActions.map((action) => (
              <button
                key={action.next}
                type="button"
                className={`row-menu__item${
                  action.next === "cancelled" ? " row-menu__item--danger" : ""
                }`}
                disabled={pending}
                onClick={() => onChangeStatus(action.next)}
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

function AppointmentRow({
  row,
  appointment,
  pending,
  onView,
  onPerform,
  onReschedule,
  onCancel,
}: {
  row: NutritionGuidanceWorklistRow;
  appointment: fhir4.Appointment;
  pending: boolean;
  onView: () => void;
  onPerform: () => void;
  onReschedule: () => void;
  onCancel: () => void;
}) {
  const returnLinkState = useReturnLinkState();
  const { patient } = row;
  const summary = summarizeNutritionGuidanceOrder(row.order);
  const status = nutritionGuidanceTaskStatus(row.task);
  const performed = todaySummary(row);

  return (
    <tr>
      <td className="sticky-table__fix-1">{appointmentTimeLabel(appointment) || "-"}</td>
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
      <td className="lab-worklist__compact">{appointmentScheduleLabel(appointment) || "-"}</td>
      <td className="lab-worklist__compact">{summary.formatShort || "-"}</td>
      <td className="lab-worklist__compact">{summary.targetDisease || "-"}</td>
      <td className="lab-worklist__compact">
        {performed || <span className="order-select__muted">未実施</span>}
      </td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {nutritionGuidanceTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="lab-worklist__actions sticky-table__fix-actions">
        {/* 予約が入っていても受付前なら実施できない(依頼をまだ受けていない)。 */}
        {status === "accepted" && (
          <button type="button" onClick={onPerform}>
            実施
          </button>
        )}
        <button type="button" onClick={onView}>
          表示
        </button>
        <RowMenu label="この予約の操作" escapesClipping>
          <button type="button" className="row-menu__item" onClick={onReschedule}>
            日時変更
          </button>
          <button
            type="button"
            className="row-menu__item row-menu__item--danger"
            disabled={pending}
            onClick={onCancel}
          >
            予約取消
          </button>
        </RowMenu>
      </td>
    </tr>
  );
}

/**
 * 終了(期間の打ち切り)。Task を completed にするだけでなく、オーダーにも終了日を
 * 書く(§3。書かないと部門一覧の occurrence=le に永久にヒットし続ける)。
 * どの日までの指導だったかは基準日と一致するとは限らないので入力させる。
 */
function NutritionGuidanceFinishModal({
  row,
  defaultEndDate,
  pending,
  onSubmit,
  onClose,
}: {
  row: NutritionGuidanceWorklistRow;
  defaultEndDate: string;
  pending: boolean;
  onSubmit: (endDate: string) => void;
  onClose: () => void;
}) {
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [error, setError] = useState("");
  const summary = summarizeNutritionGuidanceOrder(row.order);

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
    <Modal
      title={`栄養指導の終了${row.patient ? ` - ${displayName(row.patient)}` : ""}`}
      onClose={onClose}
    >
      <form className="walk-in" onSubmit={handleSubmit}>
        {error && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{error}</p>
          </div>
        )}
        <p className="appointment-panel__current">
          {[summary.formatShort, summary.targetDisease, summary.periodLabel]
            .filter(Boolean)
            .join(" / ")}
        </p>
        <div className="walk-in__fields">
          <label>
            終了日(必須)
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </label>
        </div>
        <p className="order-select__muted">
          この日を過ぎると栄養指導一覧に出なくなります。終了を取り消しても終了日は消えないので、
          期間を延ばすときはオーダーを編集してください。
        </p>
        <div className="walk-in__actions">
          <button type="submit" disabled={pending}>
            {pending ? "終了中..." : "終了する"}
          </button>
          <button type="button" onClick={onClose} disabled={pending}>
            キャンセル
          </button>
        </div>
      </form>
    </Modal>
  );
}
