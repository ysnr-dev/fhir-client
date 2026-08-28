import { today } from "../lib/dates";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useKarteLinkState } from "../karteReturn";
import {
  useAdmitUnscheduledSurgery,
  useSelfDepartments,
  useSurgeryUnscheduledList,
  useSurgeryWorklist,
  useUpdateSurgeryTaskStatus,
  type SurgeryWorklistRow,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { RowMenu } from "../components/RowMenu";
import { SurgeryCalendar, type CalendarMode } from "../components/SurgeryCalendar";
import { SurgeryPerformModal } from "../components/SurgeryPerformModal";
import { SurgeryScheduleModal } from "../components/SurgeryScheduleModal";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { toDateTimeInput } from "../fhir/clinicalNoteHelpers";
import { displayName } from "../fhir/patientHelpers";
import {
  SETTING_OPTIONS,
  orderContextSummary,
  prescriptionRequester,
  wardOf,
} from "../fhir/prescriptionHelpers";
import {
  summarizeSurgeryOrder,
  surgeryAnesthesiaMethodDisplay,
  surgeryBodySiteLabel,
  surgeryOrderItems,
  surgeryStaffRoleDisplay,
} from "../fhir/surgeryOrderHelpers";
import {
  SURGERY_TASK_STATUS_OPTIONS,
  surgeryTaskActions,
  surgeryTaskStatus,
  surgeryTaskStatusDisplay,
  type SurgeryTaskStatus,
} from "../fhir/surgeryTaskHelpers";

// 手術一覧(手術部のワークリスト)。予定手術日を決めて、その日の手術を並べる。
//
// 1 行 = オーダー 1 件 = 手術 1 件。並びは手術室 → 入室予定時刻なので、同じ部屋の
// 時間帯の重なり(ダブルブッキング)がそのまま見える(第 1 段階は予約枠を持たず、
// 部屋の取り合いはこの一覧の目視で確かめる)。
//
// 「受付」は手術部が申込を受け付けて日程を確定した印。実施入力(第 2 段階)は
// まだ無いので、進捗は 申込済 → 受付済 (→ 中止) だけ。
//
// タブは 2 つ。
//   予定日別 … 予定手術日で 1 日ぶん。希望日を書いて申し込まれたものもここに出る。
//   日程未定 … 予定手術日を入れずに申し込まれたもの(occurrence:missing)。
//              手術部がここから日程を入れて確定する。

interface Filters {
  setting: string;
  roomId: string;
  wardId: string;
  departmentId: string;
  status: string;
}

const emptyFilters: Filters = {
  setting: "",
  roomId: "",
  wardId: "",
  departmentId: "",
  status: "",
};

type Tab = "scheduled" | "unscheduled" | "calendar";

export function SurgeryWorklistPage() {
  const [tab, setTab] = useState<Tab>("scheduled");
  // カレンダーの表示単位。日と週で切り替える(SurgeryCalendar)。
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("day");
  // 予定手術日は必須。未選択にはできないので当日から始める。
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 日程を確定しようとしている申込。
  const [scheduling, setScheduling] = useState<SurgeryWorklistRow | null>(null);
  // 実施入力を開いている行。
  const [performing, setPerforming] = useState<SurgeryWorklistRow | null>(null);

  // 列が多く、既定の幅では患者名や依頼科まで折り返すので、この画面だけ幅を広げる
  // (カルテと同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useSurgeryWorklist(date);
  // 日程未定はタブを開いていなくても件数を出すので常に読む(件数は小さい)。
  const unscheduled = useSurgeryUnscheduledList();
  const departments = useSelfDepartments();
  const updateStatus = useUpdateSurgeryTaskStatus();
  const admit = useAdmitUnscheduledSurgery();

  const source = tab === "unscheduled" ? unscheduled.data : worklist.data;
  const rows = useMemo(
    () => (source?.rows ?? []).filter((row) => matchesFilters(row, filters, tab)),
    [source, filters, tab],
  );
  const total = source?.rows.length ?? 0;
  const unscheduledCount = unscheduled.data?.rows.length ?? 0;

  // 手術室・病棟の選択肢は読み込んだ 1 日ぶんのオーダーから拾う。名前はオーダーに
  // 焼き付けてあるのでマスタを引く必要がなく、その日に無い部屋を並べても仕方がない。
  const roomOptions = useMemo(
    () => optionsFrom(source?.rows ?? [], (row) => summarizeSurgeryOrder(row.order)),
    [source],
  );
  const wardOptions = useMemo(
    () =>
      optionsFrom(source?.rows ?? [], (row) => {
        const ward = wardOf(row.order);
        return { roomId: ward.wardId, roomName: ward.wardName };
      }),
    [source],
  );

  function handleDateChange(value: string) {
    // 日付を空にはさせない(空で検索すると全期間になってしまう)。
    if (value) setDate(value);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>手術一覧</h1>
      </div>

      <div className="order-select__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "scheduled"}
          className={tab === "scheduled" ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setTab("scheduled")}
        >
          予定日別
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "unscheduled"}
          className={tab === "unscheduled" ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setTab("unscheduled")}
        >
          日程未定{unscheduledCount > 0 && ` (${unscheduledCount})`}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "calendar"}
          className={tab === "calendar" ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setTab("calendar")}
        >
          カレンダー
        </button>
      </div>

      {/* カレンダーは日付送りと表示単位を自前で持つので、一覧の絞り込みは出さない。 */}
      {tab !== "calendar" && (
        <FilterForm
          // 日程未定タブは日付で絞らないので日付欄を出さない。
          date={tab === "scheduled" ? date : null}
          filters={filters}
          rooms={roomOptions}
          wards={wardOptions}
          departments={departments.departments}
          onDateChange={handleDateChange}
          onChange={setFilters}
        />
      )}

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={unscheduled.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={updateStatus.error} />
      <ErrorBanner error={admit.error} />

      {tab !== "calendar" && source?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          オーダーが多いため、一部のみ表示しています。
        </p>
      )}

      {tab === "calendar" ? (
        // 日付は一覧タブと共有する。一覧で見ていた日のままカレンダーへ移れる。
        <SurgeryCalendar
          date={date}
          onDateChange={handleDateChange}
          mode={calendarMode}
          onModeChange={setCalendarMode}
        />
      ) : (tab === "scheduled" ? worklist.isLoading : unscheduled.isLoading) ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="rad-worklist-wrap sticky-table-wrap">
            <table className="rad-worklist surgery-worklist sticky-table">
              <thead>
                <tr>
                  {/* 横に送っても「どの部屋で・いつ・誰の手術か」は残す(左 3 列を固定)。 */}
                  <th className="rad-worklist__time sticky-table__fix-1">
                    {tab === "scheduled" ? "手術室 / 入室" : "申込日"}
                  </th>
                  <th className="sticky-table__fix-2">患者番号</th>
                  <th className="sticky-table__fix-3">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="rad-worklist__content">術式</th>
                  <th>執刀医</th>
                  <th>麻酔</th>
                  <th className="rad-worklist__compact">予定区分</th>
                  <th className="rad-worklist__compact">区分</th>
                  <th className="rad-worklist__compact">病棟</th>
                  <th>依頼科 | 依頼医師</th>
                  <th className="rad-worklist__compact">ステータス</th>
                  <th className="rad-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <WorklistRow
                    key={row.order.id}
                    row={row}
                    tab={tab}
                    pending={updateStatus.isPending || admit.isPending}
                    onChangeStatus={(status) =>
                      updateStatus.mutate({ order: row.order, task: row.task, status })
                    }
                    onSchedule={() => setScheduling(row)}
                    onPerform={() => setPerforming(row)}
                    onAdmit={() =>
                      admit.mutate({
                        order: row.order,
                        task: row.task,
                        now: toDateTimeInput(new Date()),
                      })
                    }
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={14} className="master-search__empty">
                      {total === 0
                        ? tab === "scheduled"
                          ? "この予定日の手術オーダーはありません"
                          : "日程未定の手術申込はありません"
                        : "絞り込みに該当する手術がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted rad-worklist__count">{rows.length} 件</p>
        </>
      )}

      {scheduling && (
        <SurgeryScheduleModal row={scheduling} onClose={() => setScheduling(null)} />
      )}

      {performing && (
        <SurgeryPerformModal row={performing} onClose={() => setPerforming(null)} />
      )}
    </div>
  );
}

/** 1 日ぶんのオーダーから重複を除いた {id, name} の選択肢を作る。 */
function optionsFrom(
  rows: SurgeryWorklistRow[],
  pick: (row: SurgeryWorklistRow) => { roomId: string; roomName: string },
): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const row of rows) {
    const { roomId, roomName } = pick(row);
    if (roomId && !byId.has(roomId)) byId.set(roomId, roomName || roomId);
  }
  return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function matchesFilters(row: SurgeryWorklistRow, filters: Filters, tab: Tab): boolean {
  const summary = summarizeSurgeryOrder(row.order);
  if (filters.setting && summary.settingCode !== filters.setting) return false;
  // 日程未定タブは手術室もステータス(全件が申込済)も絞る意味がないので見ない。
  if (tab === "scheduled" && filters.roomId && summary.roomId !== filters.roomId) return false;

  // 病棟はオーダー登録時に焼き付けたもの。外来オーダーは病棟を持たないので、
  // 病棟で絞ると消える。
  if (filters.wardId && wardOf(row.order).wardId !== filters.wardId) return false;

  const requester = prescriptionRequester(row.order);
  if (filters.departmentId && requester.departmentId !== filters.departmentId) return false;

  if (tab === "scheduled" && filters.status && surgeryTaskStatus(row.task) !== filters.status) {
    return false;
  }

  return true;
}

interface FilterFormProps {
  /** null なら日付で絞らないタブ(日程未定)。日付欄と手術室・ステータスを出さない。 */
  date: string | null;
  filters: Filters;
  rooms: { id: string; name: string }[];
  wards: { id: string; name: string }[];
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({
  date,
  filters,
  rooms,
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
      {date !== null && (
        <>
          <label>
            予定手術日
            <input
              type="date"
              value={date}
              required
              onChange={(e) => onDateChange(e.target.value)}
            />
          </label>
          <label>
            手術室
            <select
              value={filters.roomId}
              onChange={(e) => onChange({ ...filters, roomId: e.target.value })}
            >
              <option value="">すべて</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
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
      {date !== null && (
        <label>
          ステータス
          <select
            value={filters.status}
            onChange={(e) => onChange({ ...filters, status: e.target.value })}
          >
            <option value="">すべて</option>
            {SURGERY_TASK_STATUS_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="patient-search-form__actions">
        <button type="button" onClick={() => onChange(emptyFilters)}>
          クリア
        </button>
      </div>
    </form>
  );
}

function WorklistRow({
  row,
  tab,
  pending,
  onChangeStatus,
  onSchedule,
  onPerform,
  onAdmit,
}: {
  row: SurgeryWorklistRow;
  tab: Tab;
  pending: boolean;
  onChangeStatus: (status: SurgeryTaskStatus) => void;
  onSchedule: () => void;
  onPerform: () => void;
  /** 日程未定のまま入室する(緊急手術)。 */
  onAdmit: () => void;
}) {
  // カルテの「戻る」でこの一覧に戻れるように遷移元を渡す。
  const karteLinkState = useKarteLinkState();
  const { order, patient, task } = row;
  const summary = summarizeSurgeryOrder(order);
  const items = surgeryOrderItems(order, row.itemRequests);
  const status = surgeryTaskStatus(task);
  const requester = prescriptionRequester(order);
  const actions = surgeryTaskActions(status);
  const secondaryActions = actions.filter((action) => action.secondary);
  // 麻酔チャートを開けるのは入室後(書き始める)と実施済(振り返りに読む)だけ。
  // 日程未定タブは日程を確定する画面なので出さない。
  const showChart = tab === "scheduled" && (status === "in-progress" || status === "completed");
  const surgeon = summary.staff.find((line) => line.role === "surgeon");
  const others = summary.staff.filter((line) => line.role !== "surgeon");

  return (
    <tr>
      <td className="rad-worklist__time sticky-table__fix-1">
        {tab === "scheduled" ? (
          <>
            <div>{summary.roomName || "部屋未定"}</div>
            <div>
              {summary.scheduledTime || "--:--"}
              {summary.durationMinutes != null && (
                <span className="order-select__muted">({summary.durationMinutes}分)</span>
              )}
            </div>
          </>
        ) : (
          order.authoredOn?.slice(0, 10) || "-"
        )}
      </td>
      <td className="sticky-table__fix-2">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-3">
        {patient ? (
          <>
            {/* 術前情報(病名・検査結果)を見に行けるよう、カルテへ直接飛べるようにする。
                カナは列を分けず、氏名の後ろに小さめの括弧書きで添える。 */}
            <Link to={`/patients/${patient.id}/karte`} state={karteLinkState}>
              {displayName(patient)}
            </Link>
            <PatientKana patient={patient} />
          </>
        ) : (
          "-"
        )}
      </td>
      <PatientProfileCells patient={patient} />
      <td className="rad-worklist__content">
        <ul className="rad-worklist__items">
          {items.map((item, index) => (
            <li key={item.code}>
              {index > 0 && <span className="order-select__muted">副: </span>}
              {item.name}
              {surgeryBodySiteLabel(item) && (
                <span className="order-select__muted"> {surgeryBodySiteLabel(item)}</span>
              )}
            </li>
          ))}
          {items.length === 0 && <li className="order-select__muted">術式なし</li>}
        </ul>
      </td>
      <td>
        <div>{surgeon?.practitionerName || "-"}</div>
        {others.length > 0 && (
          <div className="order-select__muted">
            {others
              .map((line) => `${surgeryStaffRoleDisplay(line.role)}: ${line.practitionerName}`)
              .join(" / ")}
          </div>
        )}
      </td>
      <td>{summary.anesthesiaMethods.map(surgeryAnesthesiaMethodDisplay).join("・") || "-"}</td>
      <td className="rad-worklist__compact">
        {/* 緊急・準緊急だけ目立たせる。予定は既定なのでバッジにしない。 */}
        {summary.priority !== "routine" ? (
          <span className="rad-worklist__status rad-worklist__status--cancelled">
            {summary.priorityDisplay}
          </span>
        ) : (
          summary.priorityDisplay
        )}
      </td>
      <td className="rad-worklist__compact">{summary.settingDisplay || "-"}</td>
      {/* オーダー登録時の入院病棟。外来オーダーと、焼き付ける前のオーダーは "-"。 */}
      <td className="rad-worklist__compact">{wardOf(order).wardName || "-"}</td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="rad-worklist__compact">
        <span className={`rad-worklist__status rad-worklist__status--${status}`}>
          {surgeryTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="rad-worklist__actions sticky-table__fix-actions">
        {tab === "unscheduled" ? (
          <>
            <button type="button" disabled={pending} onClick={onSchedule}>
              日程を確定
            </button>
            {/* 緊急・準緊急は日程の確定を待たずに始まる。押した日時がそのまま
                予定日時になり、以後は予定日別タブの当日ぶんに並ぶ。 */}
            {summary.priority !== "routine" && surgeryTaskStatus(row.task) === "requested" && (
              <button type="button" disabled={pending} onClick={onAdmit}>
                入室
              </button>
            )}
          </>
        ) : (
          actions
            .filter((action) => !action.secondary)
            .map((action) => (
              <button
                key={action.next}
                type="button"
                disabled={pending}
                onClick={() => (action.opensPerformInput ? onPerform() : onChangeStatus(action.next))}
              >
                {action.label}
              </button>
            ))
        )}
        {/* 訂正・取りやめは押し間違えると進捗が巻き戻るので、一段畳んで置く。
            麻酔チャートも毎回は開かないので同じメニューに入れる。
            一覧は横スクロールできるよう overflow を持つため、メニューは
            escapesClipping で領域の外に出す(でないと縁で切れる)。 */}
        {(secondaryActions.length > 0 || showChart) && (
          <RowMenu label="この手術の操作" escapesClipping>
            {/* 麻酔チャート(術中リアルタイム記録)。書き始めるのは入室後、
                実施済では振り返りに読む。docs/anesthesia-chart-design.md */}
            {showChart && (
              <Link className="row-menu__item" to={`/surgeries/${order.id}/anesthesia-chart`}>
                麻酔チャート
              </Link>
            )}
            {secondaryActions.map((action) => (
              <button
                key={action.next}
                type="button"
                // 中止は手術そのものを取りやめる操作なので目立たせる。取消は
                // 1 つ前に戻すだけの訂正なので通常の項目にする。
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
