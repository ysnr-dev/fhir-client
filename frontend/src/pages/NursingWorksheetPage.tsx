import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useWardNursingAssignments } from "../api/masterQueries";
import {
  useFacilitySettings,
  useMedicationSchedule,
  useNursingPerformsOn,
  useNursingWorklist,
  useWardDayOrders,
  useWardInjectionOrders,
  useWardOptions,
  useWardOralPrescriptions,
} from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { InjectionPerformModal } from "../components/InjectionPerformModal";
import { NursingPerformModal } from "../components/NursingPerformModal";
import { OralPerformModal } from "../components/OralPerformModal";
import { PathwayWardTasks } from "../components/PathwayWardTasks";
import { PatientProfileDrawer, useRowDrawer } from "../components/PatientProfileDrawer";
import { PatientKana } from "../components/PatientRowCells";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { locationDisplayName } from "../fhir/locationHelpers";
import { DEFAULT_MEAL_SCHEDULE } from "../fhir/mealOrderHelpers";
import type { NursingPerformDisplay } from "../fhir/nursingPerformHelpers";
import {
  DEFAULT_NURSING_SCHEDULE,
  SHIFT_OPTIONS,
  shiftOf,
  type ShiftCode,
} from "../fhir/nursingScheduleHelpers";
import {
  WORKSHEET_KIND_MARK,
  WORKSHEET_KIND_OPTIONS,
  dayOrderWorksheetItems,
  hourOfTime,
  injectionWorksheetItems,
  inShift,
  isLate,
  nursingWorksheetItems,
  oralWorksheetItems,
  sortWorksheetItems,
  worksheetHourColumns,
  worksheetKindDisplay,
  type WorksheetItem,
  type WorksheetKind,
} from "../fhir/nursingWorksheetHelpers";
import { displayName } from "../fhir/patientHelpers";
import { useWardInpatients } from "../hooks/useWardInpatients";
import { useNow } from "../hooks/useNow";
import { nowDateTimeInput, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 看護ワークシート(病棟の患者の 1 日)。看護指示・注射・内服・検体採取・検査や処置の予定を
// 行 = 患者、列 = 時刻(1 時間ごと)のグリッドに置き、勤務帯と受け持ち(業務分担)で絞る。
// 予定の印から各種の実施入力を開く。組み立ては fhir/nursingWorksheetHelpers.ts。
//
// 病棟は他の病棟一覧と同じくオーダーに焼き付けた order-ward で上流が絞る。患者の並び(病室順)と
// 予定の無い患者の行は、その日に病棟のベッドに居た患者から作る。

/** 勤務帯の URL の値。all は「すべて」、未指定は今日なら今の勤務帯。 */
type ShiftParam = ShiftCode | "all";

interface Filters {
  kind: WorksheetKind | "";
  /** undone = 未実施だけ。 */
  status: "" | "undone";
}

const emptyFilters: Filters = { kind: "", status: "" };

/** 受け持ちの絞り込み。mine = 自分、それ以外は看護師の Practitioner.id。空はすべて。 */
type NurseFilter = string;

export function NursingWorksheetPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wardId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();
  const nurseFilter: NurseFilter = searchParams.get("nurse") ?? "";
  const isToday = date === today();
  const now = useNow(isToday);
  const nowMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : null;
  const shiftParam = searchParams.get("shift") as ShiftParam | null;
  const shift: ShiftCode | "" =
    shiftParam === "all"
      ? ""
      : shiftParam && SHIFT_OPTIONS.some((o) => o.code === shiftParam)
        ? shiftParam
        : isToday
          ? (shiftOf(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`) ?? "")
          : "";

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 実施入力を開いている行。読み直しのたびに引き直すので key で覚える。
  const [performingKey, setPerformingKey] = useState<string | null>(null);

  // 列が多いのでこの画面だけ幅を広げる(他のワークリストと同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const wardOptions = useWardOptions();
  const ward = wardId || undefined;
  const inpatients = useWardInpatients(date, ward);
  const nursing = useNursingWorklist(date, ward);
  const injections = useWardInjectionOrders(date, ward);
  const orals = useWardOralPrescriptions(date, ward);
  const dayOrders = useWardDayOrders(date, ward);
  const assignments = useWardNursingAssignments(ward, date);
  const me = useCurrentPractitioner();
  const facility = useFacilitySettings();
  const nursingSchedule = facility.data?.nursing_schedule ?? DEFAULT_NURSING_SCHEDULE;
  const mealSchedule = facility.data?.meal_schedule ?? DEFAULT_MEAL_SCHEDULE;
  const medicationSchedule = useMedicationSchedule();
  const returnLinkState = useReturnLinkState();
  const drawer = useRowDrawer();

  function setParams(next: Record<string, string>, replace = false) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace });
  }

  // 病棟が未指定なら先頭の病棟を開く(指示簿と同じ)。
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

  const nursingOrders = useMemo(() => (nursing.data?.rows ?? []).map((row) => row.order), [nursing.data]);
  const nursingPatientIds = useMemo(
    () => nursingOrders.map((order) => order.subject?.reference?.split("/").pop() ?? ""),
    [nursingOrders],
  );
  const nursingPerforms = useNursingPerformsOn(date, nursingPatientIds);
  const nursingPerformsByOrderId = useMemo(
    () => nursingPerforms.data ?? new Map<string, NursingPerformDisplay[]>(),
    [nursingPerforms.data],
  );

  const items = useMemo(
    () =>
      sortWorksheetItems([
        ...nursingWorksheetItems(nursingOrders, nursingPerformsByOrderId, date, nursingSchedule),
        ...(injections.data ? injectionWorksheetItems(injections.data) : []),
        ...(orals.data
          ? oralWorksheetItems(orals.data, date, mealSchedule, medicationSchedule, nursingSchedule)
          : []),
        ...(dayOrders.data ? dayOrderWorksheetItems(dayOrders.data) : []),
      ]),
    [
      nursingOrders,
      nursingPerformsByOrderId,
      date,
      nursingSchedule,
      injections.data,
      orals.data,
      mealSchedule,
      medicationSchedule,
      dayOrders.data,
    ],
  );

  // 患者 id → 勤務帯 → 受け持ちの看護師(id と名前)。
  const assigneeByPatient = useMemo(() => {
    const map = new Map<string, Map<ShiftCode, { id: string; name: string }>>();
    for (const a of assignments.data ?? []) {
      const byShift = map.get(a.patient_id) ?? new Map<ShiftCode, { id: string; name: string }>();
      byShift.set(a.shift, { id: a.practitioner_id, name: a.practitioner_name ?? "" });
      map.set(a.patient_id, byShift);
    }
    return map;
  }, [assignments.data]);

  // 受け持ちの選択肢。その日の割り付けに出てくる看護師。
  const assignedNurses = useMemo(() => {
    const byId = new Map<string, string>();
    for (const a of assignments.data ?? []) {
      if (!shift || a.shift === shift) byId.set(a.practitioner_id, a.practitioner_name ?? a.practitioner_id);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], "ja"));
  }, [assignments.data, shift]);

  // 受け持ちで絞ったときに残る患者。勤務帯を選んでいればその勤務帯の受け持ちだけを見る。
  // 絞っていなければ null(全員)。
  const nurseId = nurseFilter === "mine" ? (me.practitionerId ?? "") : nurseFilter;
  const assignedPatientIds = useMemo(() => {
    if (!nurseFilter) return null;
    const ids = new Set<string>();
    for (const [patientId, byShift] of assigneeByPatient) {
      const mine = shift
        ? byShift.get(shift)?.id === nurseId
        : [...byShift.values()].some((a) => a.id === nurseId);
      if (mine) ids.add(patientId);
    }
    return ids;
  }, [nurseFilter, nurseId, assigneeByPatient, shift]);

  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          inShift(item, shift) &&
          (!assignedPatientIds || assignedPatientIds.has(item.patientId)) &&
          (!filters.kind || item.kind === filters.kind) &&
          (filters.status !== "undone" || !item.done),
      ),
    [items, shift, assignedPatientIds, filters],
  );

  // 病棟のベッドに居ない患者(転棟前のオーダーが残っている)の名前は、オーダーに添えて引いた患者から出す。
  const orderPatientsById = useMemo(() => {
    const map = new Map<string, fhir4.Patient>();
    const patients = [
      ...(nursing.data?.rows ?? []).flatMap((row) => (row.patient ? [row.patient] : [])),
      ...(injections.data?.patients ?? []),
      ...(orals.data?.patients ?? []),
      ...(dayOrders.data?.patients ?? []),
    ];
    for (const patient of patients) if (patient.id) map.set(patient.id, patient);
    return map;
  }, [nursing.data, injections.data, orals.data, dayOrders.data]);

  // 患者ごとの行。病棟に居た患者を病室順に並べ、居ないのに予定がある患者(転棟前のオーダー)は後ろへ。
  const patientGroups = useMemo(() => {
    const itemsByPatient = new Map<string, WorksheetItem[]>();
    for (const item of visible) {
      itemsByPatient.set(item.patientId, [...(itemsByPatient.get(item.patientId) ?? []), item]);
    }
    const groups = inpatients.rows
      .filter((row) => !assignedPatientIds || assignedPatientIds.has(row.patientId))
      .map((row) => ({
        patientId: row.patientId,
        patient: row.patient,
        bedLabel: row.bedLabel,
        items: itemsByPatient.get(row.patientId) ?? [],
      }));
    const known = new Set(groups.map((group) => group.patientId));
    for (const [patientId, patientItems] of itemsByPatient) {
      if (known.has(patientId)) continue;
      groups.push({ patientId, patient: orderPatientsById.get(patientId), bedLabel: "", items: patientItems });
    }
    return groups;
  }, [visible, inpatients.rows, assignedPatientIds, orderPatientsById]);

  const patientById = useMemo(
    () => new Map(inpatients.rows.map((row) => [row.patientId, row])),
    [inpatients.rows],
  );
  const performing = items.find((item) => item.key === performingKey) ?? null;
  const patientOf = (patientId: string) =>
    patientById.get(patientId)?.patient ?? orderPatientsById.get(patientId);
  const performingPatient = performing ? patientOf(performing.patientId) : undefined;
  // 患者の見出し行を押すと右に患者プロファイルを出す(指示簿と同じ)。
  const drawerGroup = patientGroups.find(
    (group) => group.patientId && patientRowKey(group.patientId) === drawer.selectedKey,
  );
  const loading =
    nursing.isLoading || injections.isLoading || orals.isLoading || dayOrders.isLoading || inpatients.isLoading;
  const undoneCount = visible.filter((item) => !item.done).length;
  const hours = worksheetHourColumns(shift);
  const nowHour = nowMinutes === null ? null : Math.floor(nowMinutes / 60);
  // マウスの乗っている列。行は :hover で塗るので、列(時)はここで覚えて見出しとセルに色を敷く。
  const [hoverColumn, setHoverColumn] = useState<SlotColumn | null>(null);
  const lateCount = visible.filter((item) => isLate(item, nowMinutes)).length;

  function refetch() {
    void nursing.refetch();
    void nursingPerforms.refetch();
    void injections.refetch();
    void orals.refetch();
    void dayOrders.refetch();
    void assignments.refetch();
  }

  function assigneeLabel(patientId: string): string {
    const byShift = assigneeByPatient.get(patientId);
    if (!byShift) return "";
    if (shift) return byShift.get(shift)?.name ?? "";
    return SHIFT_OPTIONS.map((o) => (byShift.get(o.code) ? `${o.display} ${byShift.get(o.code)?.name}` : ""))
      .filter(Boolean)
      .join(" / ");
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>看護ワークシート</h1>
        <div className="page__header-actions">
          <button type="button" onClick={refetch}>
            最新表示
          </button>
          <Link className="button" to={`/nursing-assignments?ward=${wardId}&date=${date}`}>
            業務分担
          </Link>
          <Link className="button" to={`/nursing-worklist?ward=${wardId}&date=${date}`}>
            指示簿
          </Link>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          日付
          <DateStepper value={date} onChange={(value) => value && setParams({ date: value })} />
        </label>
        <label>
          病棟
          <select value={wardId} onChange={(e) => setParams({ ward: e.target.value })}>
            {wardOptions.wards.map((w) => (
              <option key={w.id} value={w.id}>
                {locationDisplayName(w)}
              </option>
            ))}
          </select>
        </label>
        <label>
          勤務帯
          <select value={shift || "all"} onChange={(e) => setParams({ shift: e.target.value })}>
            <option value="all">すべて</option>
            {SHIFT_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          担当
          <select value={nurseFilter} onChange={(e) => setParams({ nurse: e.target.value })}>
            <option value="">すべて</option>
            {me.practitionerId && <option value="mine">自分</option>}
            {assignedNurses
              .filter(([id]) => id !== me.practitionerId)
              .map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
          </select>
        </label>
        <label>
          区分
          <select
            value={filters.kind}
            onChange={(e) => setFilters({ ...filters, kind: e.target.value as Filters["kind"] })}
          >
            <option value="">すべて</option>
            {WORKSHEET_KIND_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          状態
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters["status"] })}
          >
            <option value="">すべて</option>
            <option value="undone">未実施</option>
          </select>
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={() => setFilters(emptyFilters)}>
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={wardOptions.error} />
      <ErrorBanner error={inpatients.error} />
      <ErrorBanner error={nursing.error} />
      <ErrorBanner error={nursingPerforms.error} />
      <ErrorBanner error={injections.error} />
      <ErrorBanner error={orals.error} />
      <ErrorBanner error={dayOrders.error} />
      <ErrorBanner error={assignments.error} />
      <TruncatedNotice
        show={
          nursing.data?.truncated ||
          injections.data?.truncated ||
          orals.data?.truncated ||
          dayOrders.data?.truncated ||
          inpatients.truncated
        }
      />

      {!wardId ? (
        <p className="patient-table__empty">病棟を選んでください。</p>
      ) : loading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table
              className="lab-worklist sticky-table nursing-worksheet"
              onMouseLeave={() => setHoverColumn(null)}
            >
              <thead>
                <tr>
                  <th className="sticky-table__fix-1">患者</th>
                  <th className={slotClassName("untimed", nowHour, hoverColumn)}>随時</th>
                  {hours.map((hour) => (
                    <th key={hour} className={slotClassName(hour, nowHour, hoverColumn)}>
                      {String(hour).padStart(2, "0")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {patientGroups.map((group) => (
                  <PatientRow
                    key={group.patientId}
                    group={group}
                    hours={hours}
                    hoverColumn={hoverColumn}
                    onHoverColumn={setHoverColumn}
                    assignee={assigneeLabel(group.patientId)}
                    nowMinutes={nowMinutes}
                    returnLinkState={returnLinkState}
                    onPerform={setPerformingKey}
                    rowProps={drawer.rowProps}
                  />
                ))}
                {patientGroups.length === 0 && (
                  <tr>
                    <td colSpan={hours.length + 2} className="master-search__empty">
                      {nurseFilter ? "受け持ちの患者はいません。" : "この日に病棟に居る患者はいません。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">
            {new Set(visible.map((item) => item.patientId)).size} 人 / {visible.length} 件 / 未実施 {undoneCount} 件
            {lateCount > 0 && <span className="nursing-worklist__due--late"> / 遅れ {lateCount} 件</span>}
          </p>

          {/* クリニカルパスのタスクのうち、オーダーを持たないもの(観察・説明・文書など)。 */}
          <PathwayWardTasks
            date={date}
            wardId={wardId}
            onlyUndone={filters.status === "undone"}
            returnLinkState={returnLinkState}
            drawer={drawer}
          />
        </>
      )}

      {drawerGroup && (
        <PatientProfileDrawer
          patientId={drawerGroup.patientId}
          patient={drawerGroup.patient}
          onClose={drawer.close}
        />
      )}
      {performing?.nursingOrder && (
        <NursingPerformModal
          patientName={performingPatient ? displayName(performingPatient) : undefined}
          orders={[performing.nursingOrder]}
          // 予定の時刻、時刻の無い指示は見ている日の今の時刻(別の日を見ているとき今日に記録しないため)。
          defaultAt={`${date}T${performing.time || nowDateTimeInput().slice(11, 16)}`}
          performsByOrderId={nursingPerformsByOrderId}
          onClose={() => setPerformingKey(null)}
        />
      )}
      {performing?.injection && (
        <InjectionPerformModal
          order={performing.injection.order}
          medicationRequests={performing.injection.medicationRequests}
          task={performing.injection.task}
          performs={performing.injection.performs}
          onClose={() => setPerformingKey(null)}
        />
      )}
      {performing?.oral && (
        <OralPerformModal
          order={performing.oral.order}
          medicationRequests={performing.oral.medicationRequests}
          slotAt={performing.oral.slotAt}
          schedule={{ meal: mealSchedule, medication: medicationSchedule, nursing: nursingSchedule }}
          onClose={() => setPerformingKey(null)}
        />
      )}
    </div>
  );
}

/** 患者の見出し行の選択キー。パスのタスクの行のキーと重ならないようにする。 */
function patientRowKey(patientId: string): string {
  return `worksheet-patient:${patientId}`;
}

/**
 * 行から実施入力を開けるか(看護指示・注射・内服の未実施の予定)。検体・検査・処置は部門の画面で入れ、
 * 済みの予定の取消・訂正は経過表から行う。
 */
function canPerform(item: WorksheetItem): boolean {
  return !item.done && Boolean(item.nursingOrder || item.injection || item.oral);
}

/** 予定 1 件の印。実施入力を開ける予定はボタン、それ以外は吹き出しで内容と状態を見せるだけ。 */
function WorksheetMark({
  item,
  nowMinutes,
  onPerform,
}: {
  item: WorksheetItem;
  nowMinutes: number | null;
  onPerform: () => void;
}) {
  const late = isLate(item, nowMinutes);
  const status = item.done ? item.status || "実施済" : late ? "遅れ" : item.status || "未実施";
  const minutes = item.time.slice(3, 5);
  const className = [
    "nursing-worksheet__mark",
    item.done ? "nursing-worksheet__mark--done" : "",
    late ? "nursing-worksheet__mark--late" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const title = [
    [item.time, worksheetKindDisplay(item.kind), item.title].filter(Boolean).join(" "),
    item.detail,
    status,
  ]
    .filter(Boolean)
    .join("\n");
  const content = (
    <>
      <span className="nursing-worksheet__kind">{WORKSHEET_KIND_MARK[item.kind]}</span>
      {/* 列が時なので、ちょうどでない分だけ添える。 */}
      {minutes && minutes !== "00" && <span className="nursing-worksheet__minutes">:{minutes}</span>}
      <span className="nursing-worksheet__title">{item.title}</span>
      {item.done && <span aria-hidden="true">✓</span>}
    </>
  );
  return canPerform(item) ? (
    <button type="button" className={className} title={title} onClick={onPerform}>
      {content}
    </button>
  ) : (
    <span className={className} title={title}>
      {content}
    </span>
  );
}

/** グリッドの時刻の列。時刻の無い予定は「随時」の列。 */
type SlotColumn = number | "untimed";

/**
 * 時刻の列のセルの class。マウスの乗っている列に色を敷く。今の時は見出しにだけ印を付ける
 * (nowHour は見出しのときだけ渡す)。
 */
function slotClassName(column: SlotColumn, nowHour: number | null, hoverColumn: SlotColumn | null): string {
  return [
    "nursing-worksheet__slot",
    column === nowHour ? "nursing-worksheet__now" : "",
    column === hoverColumn ? "nursing-worksheet__hover" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function PatientRow({
  group,
  hours,
  hoverColumn,
  onHoverColumn,
  assignee,
  nowMinutes,
  returnLinkState,
  onPerform,
  rowProps,
}: {
  group: { patientId: string; patient?: fhir4.Patient; bedLabel: string; items: WorksheetItem[] };
  hours: number[];
  hoverColumn: SlotColumn | null;
  onHoverColumn: (column: SlotColumn | null) => void;
  assignee: string;
  nowMinutes: number | null;
  returnLinkState: ReturnType<typeof useReturnLinkState>;
  onPerform: (key: string) => void;
  rowProps: ReturnType<typeof useRowDrawer>["rowProps"];
}) {
  const undone = group.items.filter((item) => !item.done).length;
  const untimed = group.items.filter((item) => !item.time);
  const byHour = new Map<number, WorksheetItem[]>();
  for (const item of group.items) {
    if (!item.time) continue;
    const hour = hourOfTime(item.time);
    byHour.set(hour, [...(byHour.get(hour) ?? []), item]);
  }
  const marks = (items: WorksheetItem[]) =>
    items.map((item) => (
      <WorksheetMark key={item.key} item={item} nowMinutes={nowMinutes} onPerform={() => onPerform(item.key)} />
    ));

  return (
    <tr {...rowProps(group.patientId ? patientRowKey(group.patientId) : undefined)}>
      <th className="sticky-table__fix-1 nursing-worksheet__patient" onMouseEnter={() => onHoverColumn(null)}>
        <div>
          <span className="nursing-worklist__room">{group.bedLabel.split(" ")[0] || "-"}</span>
          {group.patient ? (
            <Link
              className="nursing-worklist__name"
              to={`/patients/${group.patientId}/karte`}
              state={returnLinkState}
            >
              {displayName(group.patient)}
            </Link>
          ) : (
            <span className="nursing-worklist__name">{group.patientId || "-"}</span>
          )}
        </div>
        {group.patient && <PatientKana patient={group.patient} />}
        <div className="nursing-worksheet__patient-sub">
          {assignee && <span>担当 {assignee}</span>}
          {undone > 0 && <span className="nursing-worksheet__undone">未実施 {undone}</span>}
          <Link to={`/patients/${group.patientId}/karte?tab=flowsheet`} state={returnLinkState}>
            経過表
          </Link>
        </div>
      </th>
      <td
        className={slotClassName("untimed", null, hoverColumn)}
        onMouseEnter={() => onHoverColumn("untimed")}
      >
        {marks(untimed)}
      </td>
      {hours.map((hour) => (
        <td
          key={hour}
          className={slotClassName(hour, null, hoverColumn)}
          onMouseEnter={() => onHoverColumn(hour)}
        >
          {marks(byHour.get(hour) ?? [])}
        </td>
      ))}
    </tr>
  );
}
