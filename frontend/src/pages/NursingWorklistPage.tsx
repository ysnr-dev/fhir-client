import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useNursingActLevels } from "../api/masterQueries";
import {
  useAcceptNursingOrders,
  useFacilitySettings,
  useInpatientEncounters,
  useNursingPerformsOn,
  useNursingWorklist,
  useRevokeNursingOrder,
  useSelfDepartments,
  useWardOptions,
  type NursingWorklistRow,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { NursingOrderDetailModal } from "../components/NursingOrderDetailModal";
import { NursingPerformModal } from "../components/NursingPerformModal";
import { PatientKana } from "../components/PatientRowCells";
import { RowMenu } from "../components/RowMenu";
import { encounterBedLabel, encounterPatientId } from "../fhir/encounterHelpers";
import { displayJapaneseName } from "../fhir/humanName";
import {
  nursingOrderPeriodLabel,
  summarizeNursingOrder,
  type NursingOrderGroup,
} from "../fhir/nursingOrderHelpers";
import {
  nursingTaskOwnerName,
  nursingTaskStatus,
  nursingTaskStatusDisplay,
} from "../fhir/nursingTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import type { NursingPerformDisplay } from "../fhir/nursingPerformHelpers";
import {
  DEFAULT_NURSING_SCHEDULE,
  expandNursingSchedule,
  isDueAround,
  matchPerformsToSchedule,
  minutesOfTime,
  nextDueSlot,
  nursingScheduleOf,
  type NursingScheduleSlot,
} from "../fhir/nursingScheduleHelpers";
import { useNow } from "../hooks/useNow";
import { locationDisplayName } from "../fhir/locationHelpers";
import { prescriptionRequester } from "../fhir/prescriptionHelpers";
import { today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 病棟の指示簿(看護指示のワークリスト)。
//
// **他の部門一覧と依頼を受ける側が違う。** 検査・処置は部門が受けるので「その日に
// 実施予定のオーダー」を部門ごとに並べるが、看護指示を受けるのは病棟なので、
// 絞り込みの主軸が病棟になる。しかも病棟だけは **上流の ward 検索でサーバー側で絞る**
// (看護指示は退院まで status=active のまま残るので、全病院ぶんを引いてから捨てると
// 際限なく重くなる。api/queries.ts の fetchNursingWorklist を参照)。
//
// 軸はリハビリ一覧と同じで、基準日に効いている(始まっていて、まだ終わっていない)
// 指示を並べる。1 つの指示が入院中ずっと続き、看護師はそれを受けて実施していく。
//
// 行は **患者でまとめる**。病棟の作業単位が患者(ラウンドで 1 人ぶんの新しい指示を
// まとめて受ける)で、フラットに並べると同じ患者名が何行も続くため。
//
// 中止は置くが編集は置かない。指示の内容を変えるのは医師の操作で、カルテの右ペイン
// (NursingOrderPanels)が担当する。

// pending = 未指示受け / all = 全指示 / due = 実施予定(いま入れるべき指示)
type View = "pending" | "all" | "due";

function parseView(value: string | null): View {
  return value === "all" || value === "due" ? value : "pending";
}

interface Filters {
  departmentId: string;
  status: string;
}

const emptyFilters: Filters = { departmentId: "", status: "" };

/** 患者 1 人ぶん。指示は基準日に効いているものだけが入る。 */
interface PatientGroupData {
  patientId: string;
  patient?: fhir4.Patient;
  /** 「301号室」。表示は病室まで(ベッド番号は病棟の指示簿では使わない)。 */
  roomLabel: string;
  /** 「301号室 ベッド1」。並び順にだけ使う。 */
  bedLabel: string;
  rows: NursingWorklistRow[];
  pendingRows: NursingWorklistRow[];
  /** いま実施予定のある指示(遅れ、または現在時刻の前後 1 時間に未実施の予定)。 */
  dueRows: NursingWorklistRow[];
}

/** 予定と実施の突き合わせ結果。予定を持たない指示は slots が空。 */
interface ScheduleState {
  slots: NursingScheduleSlot[];
  extra: NursingPerformDisplay[];
  due: boolean;
  /** 遅れている予定があるか。 */
  late: boolean;
}

export function NursingWorklistPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wardId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();
  const view: View = parseView(searchParams.get("view"));

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 開いている対象は行そのものではなく id で覚え、読み直しのたびに引き直す。
  const [detailId, setDetailId] = useState<string | null>(null);
  // 実施入力を開いている患者。id で覚えて読み直しのたびに引き直す(detailId と同じ)。
  const [performingPatientId, setPerformingPatientId] = useState<string | null>(null);

  // 列が多いのでこの画面だけ幅を広げる(他のワークリストと同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const wardOptions = useWardOptions();
  const worklist = useNursingWorklist(date, wardId || undefined);
  // 病室・ベッドは入院患者一覧と同じキャッシュに乗る(行き来しても引き直さない)。
  const inpatients = useInpatientEncounters(date);
  const departments = useSelfDepartments();
  const levels = useNursingActLevels();
  const me = useCurrentPractitioner();
  const accept = useAcceptNursingOrders();
  const revoke = useRevokeNursingOrder();
  const returnLinkState = useReturnLinkState();
  const facility = useFacilitySettings();
  const scheduleSettings = facility.data?.nursing_schedule ?? DEFAULT_NURSING_SCHEDULE;
  // 「実施予定」は現在時刻で決まるので、基準日が今日のときだけ 1 分ごとに追従する。
  const isToday = date === today();
  const now = useNow(isToday);
  const nowMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : null;

  function setParams(next: Record<string, string>, replace = false) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace });
  }

  // 病棟が未指定なら先頭の病棟を開く。履歴を汚さないよう replace で書く。
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || wardId) return;
    const first = wardOptions.wards[0];
    if (!first?.id) return;
    initialized.current = true;
    setParams({ ward: first.id }, true);
    // 初回に一度だけ動けばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardId, wardOptions.wards]);

  // 病棟や日付が変わると行がまるごと入れ替わる。前の病棟の id を選んだまま
  // 「選択した N 件を指示受け」を押せてしまうので、選択を捨てる。
  useEffect(() => setSelected(new Set()), [wardId, date]);

  const allRows = useMemo(() => worklist.data?.rows ?? [], [worklist.data]);
  const rows = useMemo(
    () => allRows.filter((row) => matchesFilters(row, filters)),
    [allRows, filters],
  );

  // 患者 id -> 病室・ベッド。入院を引けた患者だけ。
  const bedByPatientId = useMemo(() => {
    const map = new Map<string, string>();
    for (const encounter of inpatients.data?.encounters ?? []) {
      const patientId = encounterPatientId(encounter);
      if (patientId && !map.has(patientId)) map.set(patientId, encounterBedLabel(encounter));
    }
    return map;
  }, [inpatients.data]);

  // その日の実施記録(「本日」列と実施予定)。ワークリスト本体とは別に引く(入院患者一覧の
  // バッジが同じキャッシュを使うので、そちらに Observation を読ませないため)。
  const patientIds = useMemo(
    () => [...new Set(rows.map((row) => row.order.subject?.reference?.split("/").pop() ?? ""))],
    [rows],
  );
  const performs = useNursingPerformsOn(date, patientIds);
  const performsByOrderId = useMemo(
    () => performs.data ?? new Map<string, NursingPerformDisplay[]>(),
    [performs.data],
  );

  // 指示ごとの予定と実施の突き合わせ。基準日が今日でなければ「未実施の予定があるか」だけ見る。
  const scheduleByOrderId = useMemo(() => {
    const map = new Map<string, ScheduleState>();
    for (const row of rows) {
      const id = row.order.id ?? "";
      const times = expandNursingSchedule(nursingScheduleOf(row.order), date, scheduleSettings);
      const { slots, extra } = matchPerformsToSchedule(times, performsByOrderId.get(id) ?? []);
      const next = nowMinutes === null ? null : nextDueSlot(slots, nowMinutes);
      map.set(id, {
        slots,
        extra,
        due:
          slots.length > 0 &&
          (nowMinutes === null ? slots.some((s) => !s.done) : isDueAround(slots, nowMinutes)),
        late: Boolean(next?.late),
      });
    }
    return map;
  }, [rows, date, scheduleSettings, performsByOrderId, nowMinutes]);

  // 患者ごとにまとめる。並びは病室・ベッド順(引けなければ患者番号順のまま末尾へ)。
  const groups = useMemo<PatientGroupData[]>(() => {
    const byPatient = new Map<string, PatientGroupData>();
    for (const row of rows) {
      const patientId = row.order.subject?.reference?.split("/").pop() ?? "";
      let group = byPatient.get(patientId);
      if (!group) {
        group = {
          patientId,
          patient: row.patient,
          bedLabel: bedByPatientId.get(patientId) ?? "",
          roomLabel: roomOf(bedByPatientId.get(patientId) ?? ""),
          rows: [],
          pendingRows: [],
          dueRows: [],
        };
        byPatient.set(patientId, group);
      }
      group.rows.push(row);
      if (isPending(row)) group.pendingRows.push(row);
      if (scheduleByOrderId.get(row.order.id ?? "")?.due) group.dueRows.push(row);
    }

    const list = [...byPatient.values()];
    list.sort((a, b) => {
      if (a.bedLabel && b.bedLabel) return a.bedLabel.localeCompare(b.bedLabel, "ja");
      return a.bedLabel ? -1 : b.bedLabel ? 1 : 0;
    });
    // 実施予定は遅れているもの → 次の予定が早いものの順(患者の中で)。
    const dueTime = (row: NursingWorklistRow) => {
      const state = scheduleByOrderId.get(row.order.id ?? "");
      const next = state && nowMinutes !== null ? nextDueSlot(state.slots, nowMinutes) : null;
      const pending = next?.slot ?? state?.slots.find((s) => !s.done);
      return pending ? minutesOfTime(pending.time) : 9999;
    };
    for (const group of list) group.dueRows.sort((a, b) => dueTime(a) - dueTime(b));

    // 未指示受け・実施予定のビューは、対象の無い患者を出さない。
    if (view === "pending") return list.filter((g) => g.pendingRows.length > 0);
    if (view === "due") return list.filter((g) => g.dueRows.length > 0);
    return list;
  }, [rows, bedByPatientId, view, scheduleByOrderId, nowMinutes]);

  // 表に出す行(ビューで絞ったあと)。指示受けの対象もここから数える。
  const visibleRows = useMemo(
    () =>
      groups.flatMap((group) =>
        view === "pending" ? group.pendingRows : view === "due" ? group.dueRows : group.rows,
      ),
    [groups, view],
  );
  const pendingRows = useMemo(() => rows.filter(isPending), [rows]);
  const dueCount = useMemo(
    () => rows.filter((row) => scheduleByOrderId.get(row.order.id ?? "")?.due).length,
    [rows, scheduleByOrderId],
  );
  const selectedRows = visibleRows.filter(
    (row) => isPending(row) && selected.has(row.order.id ?? ""),
  );

  const detailRow = allRows.find((row) => row.order.id === detailId) ?? null;
  const performingGroup = groups.find((group) => group.patientId === performingPatientId) ?? null;
  const ownerName = me.practitioner ? displayJapaneseName(me.practitioner.name) : "";
  const canAccept = Boolean(me.practitionerId);

  const groupName = (group: NursingOrderGroup): string => {
    if (group.kind === "observation") return "観察";
    if (group.kind === "free") return "その他";
    const l1 = levels.data?.levels.find((l) => l.code === group.level1Code);
    return l1?.name ?? group.level1Code;
  };

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 患者ぶんをまとめて選ぶ・外す。 */
  function togglePatient(patientRows: NursingWorklistRow[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of patientRows) {
        const id = row.order.id ?? "";
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function handleAccept(target: NursingWorklistRow[]) {
    if (!me.practitionerId || target.length === 0) return;
    accept.mutate(
      {
        rows: target.map((row) => ({ order: row.order, task: row.task })),
        owner: { practitionerId: me.practitionerId, display: ownerName },
      },
      { onSuccess: () => setSelected(new Set()) },
    );
  }

  function handleRevoke(row: NursingWorklistRow) {
    const label = summarizeNursingOrder(row.order).text;
    if (!window.confirm(`「${label}」を中止します。よろしいですか？`)) return;
    revoke.mutate({ order: row.order, task: row.task });
  }

  function handleDateChange(value: string) {
    // 日付を空にはさせない(空で検索すると全期間になってしまう)。
    if (!value) return;
    setParams({ date: value });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>指示簿</h1>
        {/* 病棟の患者そのもの(ベッドの埋まり具合・担当看護師)を見たいときの戻り先。
            見ている病棟と基準日をそのまま渡す。 */}
        <Link className="button" to={`/inpatients?ward=${wardId}&date=${date}`}>
          入院患者一覧
        </Link>
      </div>

      {/* 2 つのビューは絞り込みではなく見る軸の切り替えなのでタブに出す
          (リハビリ一覧の依頼/予約と同じ)。 */}
      <div className="order-select__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "pending"}
          className={view === "pending" ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setParams({ view: "" })}
        >
          未指示受け{pendingRows.length > 0 && ` (${pendingRows.length})`}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "due"}
          className={view === "due" ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setParams({ view: "due" })}
        >
          実施予定{dueCount > 0 && ` (${dueCount})`}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "all"}
          className={view === "all" ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setParams({ view: "all" })}
        >
          全指示
        </button>
      </div>

      <FilterForm
        date={date}
        wardId={wardId}
        filters={filters}
        wards={wardOptions.wards}
        departments={departments.departments}
        onDateChange={handleDateChange}
        onWardChange={(value) => setParams({ ward: value })}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={wardOptions.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={accept.error} />
      <ErrorBanner error={revoke.error} />

      {worklist.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          この病棟の指示が多いため、一部のみ表示しています。
        </p>
      )}

      {!wardId ? (
        <p className="patient-table__empty">病棟を選んでください。</p>
      ) : worklist.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          {pendingRows.length > 0 && (
            <div className="nursing-tab__accept">
              <span>指示受け待ち {pendingRows.length} 件</span>
              <button
                type="button"
                disabled={!canAccept || accept.isPending || selectedRows.length === 0}
                onClick={() => handleAccept(selectedRows)}
                title={canAccept ? undefined : "医療従事者に紐づくアカウントでログインしてください"}
              >
                選択した {selectedRows.length} 件を指示受け
              </button>
              <button
                type="button"
                disabled={!canAccept || accept.isPending}
                onClick={() => handleAccept(pendingRows)}
              >
                すべて指示受け
              </button>
            </div>
          )}

          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="nursing-worklist__check"></th>
                  <th className="lab-worklist__compact">区分</th>
                  <th>指示内容</th>
                  <th className="lab-worklist__compact">頻度・条件</th>
                  <th className="lab-worklist__compact">期間</th>
                  <th className="lab-worklist__compact">指示医</th>
                  <th className="lab-worklist__compact">指示受け</th>
                  <th className="lab-worklist__compact">本日</th>
                  <th className="lab-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <PatientGroup
                    key={group.patientId}
                    group={group}
                    view={view}
                    date={date}
                    groupName={groupName}
                    selected={selected}
                    pending={accept.isPending || revoke.isPending}
                    returnLinkState={returnLinkState}
                    performsByOrderId={performsByOrderId}
                    scheduleByOrderId={scheduleByOrderId}
                    nowMinutes={nowMinutes}
                    onToggle={toggle}
                    onTogglePatient={togglePatient}
                    onPerform={() => setPerformingPatientId(group.patientId)}
                    onView={setDetailId}
                    onRevoke={handleRevoke}
                  />
                ))}
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={9} className="master-search__empty">
                      {allRows.length === 0
                        ? "この日に効いている看護指示はありません。"
                        : view === "pending"
                          ? "指示受け待ちの指示はありません。"
                          : view === "due"
                            ? "いま実施予定の指示はありません。"
                            : "絞り込みに一致する指示がありません。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="order-select__muted lab-worklist__count">
            {groups.length} 人 / {visibleRows.length} 件
          </p>
        </>
      )}

      {performingGroup && (
        <NursingPerformModal
          patientName={performingGroup.patient ? displayName(performingGroup.patient) : undefined}
          // 有効な指示すべて(未指示受けビューでも、受け済みの指示に記録できるように)。
          orders={performingGroup.rows.map((row) => row.order)}
          performsByOrderId={performsByOrderId}
          onClose={() => setPerformingPatientId(null)}
        />
      )}

      {detailRow && (
        <NursingOrderDetailModal
          order={detailRow.order}
          task={detailRow.task}
          at={date}
          patientName={detailRow.patient ? displayName(detailRow.patient) : undefined}
          canDeletePerform
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

/**
 * 「301号室 ベッド1」から病室だけを取り出す。指示簿は患者を探す画面なので、
 * ベッド番号まで出すと病室が読み取りにくくなる(並び順にはベッドまで使う)。
 */
function roomOf(bedLabel: string): string {
  return bedLabel.split(" ")[0] ?? "";
}

/** 未指示受けか(有効な指示で、まだ誰も受けていない)。 */
function isPending(row: NursingWorklistRow): boolean {
  return row.order.status === "active" && nursingTaskStatus(row.task) === "requested";
}

function matchesFilters(row: NursingWorklistRow, filters: Filters): boolean {
  if (filters.departmentId) {
    const requester = prescriptionRequester(row.order);
    if (requester.departmentId !== filters.departmentId) return false;
  }
  if (filters.status && nursingTaskStatus(row.task) !== filters.status) return false;
  return true;
}

interface FilterFormProps {
  date: string;
  wardId: string;
  filters: Filters;
  wards: fhir4.Location[];
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onWardChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({
  date,
  wardId,
  filters,
  wards,
  departments,
  onDateChange,
  onWardChange,
  onChange,
}: FilterFormProps) {
  function handleSubmit(e: FormEvent) {
    // 選んだ瞬間に効くので、Enter では何もしない。
    e.preventDefault();
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        基準日
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          required
        />
      </label>
      <label>
        病棟
        <select value={wardId} onChange={(e) => onWardChange(e.target.value)}>
          {wards.map((ward) => (
            <option key={ward.id} value={ward.id}>
              {locationDisplayName(ward)}
            </option>
          ))}
        </select>
      </label>
      <label>
        依頼科
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
        指示受け
        <select
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
        >
          <option value="">すべて</option>
          <option value="requested">指示受け待ち</option>
          <option value="accepted">指示受け済</option>
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

interface PatientGroupProps {
  group: PatientGroupData;
  view: View;
  date: string;
  groupName: (group: NursingOrderGroup) => string;
  selected: Set<string>;
  pending: boolean;
  returnLinkState: ReturnType<typeof useReturnLinkState>;
  performsByOrderId: Map<string, NursingPerformDisplay[]>;
  scheduleByOrderId: Map<string, ScheduleState>;
  nowMinutes: number | null;
  onToggle: (id: string) => void;
  onTogglePatient: (rows: NursingWorklistRow[], checked: boolean) => void;
  onPerform: () => void;
  onView: (srId: string) => void;
  onRevoke: (row: NursingWorklistRow) => void;
}

// 患者 1 人ぶん。見出し行に病室・氏名・未指示受け件数と「この患者を指示受け」を置く。
function PatientGroup({
  group,
  view,
  date,
  groupName,
  selected,
  pending,
  returnLinkState,
  performsByOrderId,
  scheduleByOrderId,
  nowMinutes,
  onToggle,
  onTogglePatient,
  onPerform,
  onView,
  onRevoke,
}: PatientGroupProps) {
  const rows = view === "pending" ? group.pendingRows : view === "due" ? group.dueRows : group.rows;
  const checkedCount = group.pendingRows.filter((row) =>
    selected.has(row.order.id ?? ""),
  ).length;
  const allChecked = group.pendingRows.length > 0 && checkedCount === group.pendingRows.length;
  const someChecked = checkedCount > 0;

  return (
    <>
      <tr className="nursing-worklist__patient">
        {/* 患者ぶんをまとめて選ぶチェック。指示行のチェックと縦に揃える。 */}
        <th className="nursing-worklist__check">
          {group.pendingRows.length > 0 && (
            <input
              type="checkbox"
              checked={allChecked}
              // 一部だけ選んでいるときは「この患者の一部」を表す中間状態にする。
              ref={(el) => {
                if (el) el.indeterminate = !allChecked && someChecked;
              }}
              onChange={() => onTogglePatient(group.pendingRows, !allChecked)}
              aria-label={`${group.patient ? displayName(group.patient) : "この患者"} の指示をまとめて選ぶ`}
            />
          )}
        </th>
        <th colSpan={8}>
          <span className="nursing-worklist__room">{group.roomLabel || "-"}</span>
          {group.patient ? (
            <>
              {/* カルテの指示簿タブを直接開く。 */}
              <Link
                className="nursing-worklist__name"
                to={`/patients/${group.patient.id}/karte?tab=nursing`}
                state={returnLinkState}
              >
                {displayName(group.patient)}
              </Link>
              <PatientKana patient={group.patient} />
            </>
          ) : (
            <span className="nursing-worklist__name">{group.patientId || "-"}</span>
          )}
          {group.pendingRows.length > 0 && (
            <span className="nursing-worklist__pending">
              未指示受け {group.pendingRows.length} 件
            </span>
          )}
          {/* 実施は患者単位でまとめて入れる(ラウンドの運用)。 */}
          <button type="button" className="nursing-worklist__perform" onClick={onPerform}>
            実施入力
          </button>
        </th>
      </tr>
      {rows.map((row) => (
        <OrderRow
          key={row.order.id}
          row={row}
          date={date}
          groupName={groupName}
          todayPerforms={performsByOrderId.get(row.order.id ?? "") ?? []}
          schedule={scheduleByOrderId.get(row.order.id ?? "")}
          nowMinutes={nowMinutes}
          checked={selected.has(row.order.id ?? "")}
          pending={pending}
          onToggle={() => onToggle(row.order.id ?? "")}
          onView={() => onView(row.order.id ?? "")}
          onRevoke={() => onRevoke(row)}
        />
      ))}
    </>
  );
}

function OrderRow({
  row,
  date,
  groupName,
  todayPerforms,
  schedule,
  nowMinutes,
  checked,
  pending,
  onToggle,
  onView,
  onRevoke,
}: {
  row: NursingWorklistRow;
  date: string;
  groupName: (group: NursingOrderGroup) => string;
  /** その日の実施記録(新しい順)。 */
  todayPerforms: NursingPerformDisplay[];
  /** 予定との突き合わせ。予定を持たない指示は slots が空。 */
  schedule: ScheduleState | undefined;
  nowMinutes: number | null;
  checked: boolean;
  pending: boolean;
  onToggle: () => void;
  onView: () => void;
  onRevoke: () => void;
}) {
  const summary = summarizeNursingOrder(row.order);
  const taskStatus = nursingTaskStatus(row.task);
  const acceptable = isPending(row);

  return (
    <tr>
      <td className="nursing-worklist__check">
        {acceptable && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label="指示受けの対象にする"
          />
        )}
      </td>
      <td className="lab-worklist__compact">{groupName(summary.group)}</td>
      <td>
        {summary.text}
        {summary.comment && <div className="nursing-tab__comment">{summary.comment}</div>}
      </td>
      <td className="lab-worklist__compact">{summary.frequency}</td>
      <td className="lab-worklist__compact nursing-tab__period">
        {nursingOrderPeriodLabel(summary, date)}
      </td>
      <td className="lab-worklist__compact">{summary.requesterName}</td>
      <td className="lab-worklist__compact">
        <span
          className={`lab-worklist__status lab-worklist__status--${taskStatus}`}
          // 受けた人は詳細で見る。列幅を取らないよう吹き出しに留める。
          title={nursingTaskOwnerName(row.task) || undefined}
        >
          {nursingTaskStatusDisplay(taskStatus)}
        </span>
      </td>
      {/* その日にもう記録したか。期間型なので「実施済かどうか」は日ごとに見る。
          予定を持つ指示は「実施済/予定」の回数と、遅れていれば強調。予定の無い指示は
          最新の値を出し、複数回なら吹き出しに全部並べる。 */}
      {schedule && schedule.slots.length > 0 ? (
        <td
          className={`lab-worklist__compact nursing-worklist__due${schedule.late ? " nursing-worklist__due--late" : ""}`}
          title={[
            ...schedule.slots.map((s) => `${s.time} ${s.done ? `✓ ${s.done.value}` : "未"}`),
            ...schedule.extra.map((p) => `予定外 ${p.atLabel} ${p.value}`),
          ].join("\n")}
        >
          {schedule.slots.filter((s) => s.done).length}/{schedule.slots.length}
          {(() => {
            const next = nowMinutes === null ? null : nextDueSlot(schedule.slots, nowMinutes);
            return next ? (
              <span className="nursing-tab__owner">
                {" "}
                {next.late ? "遅れ" : "次"} {next.slot.time}
              </span>
            ) : null;
          })()}
        </td>
      ) : (
        <td
          className="lab-worklist__compact"
          title={
            todayPerforms.length > 1
              ? todayPerforms.map((p) => `${p.atLabel} ${p.value}`).join("\n")
              : undefined
          }
        >
          {todayPerforms.length > 0 ? (
            <>
              {todayPerforms[0].value}
              {todayPerforms.length > 1 && (
                <span className="nursing-tab__owner"> 他{todayPerforms.length - 1}</span>
              )}
            </>
          ) : (
            <span className="order-select__muted">未</span>
          )}
        </td>
      )}
      <td className="lab-worklist__actions sticky-table__fix-actions">
        <button type="button" onClick={onView}>
          表示
        </button>
        {/* 中止は押し間違えると指示が消えるので一段畳む。内容の編集はカルテの右ペイン。 */}
        {row.order.status === "active" && (
          <RowMenu label={`${summary.text} の操作`} escapesClipping>
            <button
              type="button"
              className="row-menu__item row-menu__item--danger"
              disabled={pending}
              onClick={onRevoke}
            >
              中止
            </button>
          </RowMenu>
        )}
      </td>
    </tr>
  );
}
