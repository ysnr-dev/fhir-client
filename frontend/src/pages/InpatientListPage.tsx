import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useCancelAdmission,
  useInpatientEncounters,
  usePlannedAdmissions,
  useUpdateEncounter,
  useWardGrid,
  useNursingPendingCounts,
  useWardOptions,
} from "../api/queries";
import { AdmissionExecuteModal } from "../components/AdmissionExecuteModal";
import { AdmissionModal } from "../components/AdmissionModal";
import { BedTransferModal } from "../components/BedTransferModal";
import { DischargeModal } from "../components/DischargeModal";
import { DischargePlanModal } from "../components/DischargePlanModal";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  DischargePlanTable,
  DischargedTable,
  LeaveTable,
  TransferPlanTable,
  type DischargePlanRow,
  type DischargedRow,
  type LeaveRow,
  type TransferPlanRow,
} from "../components/InpatientPlanTables";
import { LeaveModal } from "../components/LeaveModal";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { PlannedAdmissionModal } from "../components/PlannedAdmissionModal";
import { RowMenu } from "../components/RowMenu";
import { TransferPlanModal } from "../components/TransferPlanModal";
import {
  ADMISSION_STATUS,
  DISCHARGED_STATUS,
  buildPlanCancelledEncounter,
  encounterAdmissionDate,
  encounterAttendingId,
  encounterAttendingName,
  encounterBedId,
  encounterDepartmentId,
  encounterDepartmentName,
  encounterDischargeDate,
  encounterDischargePlan,
  encounterLeaves,
  encounterNote,
  encounterNurseIds,
  encounterNurseNames,
  encounterPatientId,
  encounterTransferPlan,
  plannedBedName,
  plannedRoomName,
  plannedWardId,
} from "../fhir/encounterHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { displayName } from "../fhir/patientHelpers";
import { addDays } from "../fhir/scheduleHelpers";
import { bedDisplayName, bedNumber, bedShortLabel } from "../fhir/wardHelpers";
import { KARTE_TAB_PARAM } from "../karteUrl";
import { useReturnLinkState } from "../returnTo";
import { dateTimeLabel, today } from "../lib/dates";

// 入院患者一覧。「入院患者」と「入院予定」の 2 つのタブを持つ。
//
// 入院患者タブは、病棟を選ぶとその病棟の病室・ベッドを 1 行 1 床で並べ、
// 埋まっている床には入院中の患者を、空いている床には「患者選択」を出す。
// 入院予定タブは、選んだ病棟に入院する予定(status=planned の Encounter)を
// 予定日順に 1 行 1 件で並べる。予定はまだ床が決まっていないことがあるので、
// ベッドのグリッドではなく予定そのものを行にする。
//
// 入院は Encounter(fhir/encounterHelpers.ts)。ベッドの Location と Encounter を
// ベッド id で突き合わせるだけなので、病室・ベッドの側は病棟マスタそのまま。
//
// 選んだ病棟・日付・タブは URL の ?ward= / ?date= / ?tab= に持つ。カルテへ渡す
// 戻り先(karteFrom)は検索文字列を含むので、カルテから戻ったときに同じ表示が開く。
//
// 日付は「その日にベッドを使っていた人」を出すためのもの(退院済みも含む)で、
// 診療科・主治医・担当看護師の絞り込みとは別扱い。日付を変えても空床は出す。
// 入院予定タブは日付で絞らない(未来の予定を全部見せる)ので、日付は出さない。

/**
 * タブの並び。key はそのまま URL の ?tab= に入る(入院患者は既定なので、
 * そのときだけパラメータを置かない)。
 */
const TABS = [
  { key: "planned", label: "入院予定" },
  { key: "current", label: "入院患者" },
  { key: "transfer", label: "転科・転棟" },
  { key: "leave", label: "外出泊" },
  { key: "discharge", label: "退院予定" },
  { key: "discharged", label: "退院患者" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * 日付を必ず 1 つ持つタブ。ここは「絞り込み」ではなく「いつの状況を見るか」なので、
 * 空にできる他のタブの日付とは扱いを分ける(既定は今日で、日送りのボタンも付ける)。
 */
const DATED_TABS = ["current", "discharged"] as const;

type DatedTabKey = (typeof DATED_TABS)[number];

/** タブごとの日付の絞り込みが使う URL のパラメータ名。 */
const DATE_PARAMS = {
  planned: "plan-date",
  transfer: "transfer-date",
  leaveFrom: "leave-from",
  leaveTo: "leave-to",
  discharge: "discharge-date",
  discharged: "discharged-date",
} as const;

/**
 * タブごとに出す日付の絞り込み欄。入院患者タブは基準日があるので持たない。
 * 外出泊だけは開始日と終了日の 2 つを持つ(表の日付の列がそのまま 2 つあるので、
 * どちらでも引けるようにする)。
 */
const DATE_FILTERS: Record<Exclude<TabKey, DatedTabKey>, { param: string; label: string }[]> = {
  planned: [{ param: DATE_PARAMS.planned, label: "入院予定日" }],
  transfer: [{ param: DATE_PARAMS.transfer, label: "転科・転棟予定日" }],
  leave: [
    { param: DATE_PARAMS.leaveFrom, label: "外出泊開始日" },
    { param: DATE_PARAMS.leaveTo, label: "外出泊終了日" },
  ],
  discharge: [{ param: DATE_PARAMS.discharge, label: "退院予定日" }],
};

function isDatedTab(tab: TabKey): tab is DatedTabKey {
  return (DATED_TABS as readonly string[]).includes(tab);
}

/** 日付を 1 日ずつ送れる入力。基準日(入院患者)と退院日(退院患者)で使う。 */
function DateStepper({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="inpatient__date">
      <button type="button" onClick={() => onChange(addDays(value, -1))} aria-label="前の日">
        &lt;
      </button>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value || today())} />
      <button type="button" onClick={() => onChange(addDays(value, 1))} aria-label="次の日">
        &gt;
      </button>
      <button type="button" onClick={() => onChange(today())} disabled={value === today()}>
        今日
      </button>
    </div>
  );
}

interface InpatientRow {
  room: fhir4.Location;
  bed: fhir4.Location;
  /** 病室セルの rowspan。病室の 2 床目以降は 0(セルを出さない)。 */
  roomRowSpan: number;
  encounter?: fhir4.Encounter;
  patient?: fhir4.Patient;
}

interface PlannedRow {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
}

/** 入院中の行のケバブから開くモーダル。 */
interface RowAction {
  kind: "bedTransfer" | "leave" | "transferPlan" | "dischargePlan";
  row: InpatientRow;
}

interface Filters {
  departmentId: string;
  practitionerId: string;
  nurseId: string;
}

const emptyFilters: Filters = { departmentId: "", practitionerId: "", nurseId: "" };

/** 参照 id と表示名の組。診療科・主治医の絞り込みの選択肢に使う。 */
interface FilterOption {
  id: string;
  name: string;
}

/**
 * 病室セルの rowspan を「並べる行」から数え直す。絞り込みで同じ病室の行が減ることが
 * あるので、ベッドの総数ではなく実際に出す行数で決める。
 */
function withRoomRowSpans(rows: Omit<InpatientRow, "roomRowSpan">[]): InpatientRow[] {
  return rows.map((row, index) => {
    if (index > 0 && rows[index - 1].room.id === row.room.id) {
      return { ...row, roomRowSpan: 0 };
    }
    let span = 1;
    while (index + span < rows.length && rows[index + span].room.id === row.room.id) span += 1;
    return { ...row, roomRowSpan: span };
  });
}

/**
 * Encounter から絞り込みの選択肢を作る。名前順、重複は潰す。
 * 担当看護師のように 1 件の Encounter が複数の候補を持つことがあるので、
 * pick は配列を返す。
 */
function filterOptions(
  encounters: fhir4.Encounter[],
  pick: (encounter: fhir4.Encounter) => { id?: string; name: string }[],
): FilterOption[] {
  const byId = new Map<string, string>();
  for (const encounter of encounters) {
    for (const { id, name } of pick(encounter)) {
      if (id && !byId.has(id)) byId.set(id, name);
    }
  }
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/** 絞り込み(診療科・主治医・担当看護師)に合うか。 */
function matchesFilters(encounter: fhir4.Encounter, filters: Filters): boolean {
  return (
    (!filters.departmentId || encounterDepartmentId(encounter) === filters.departmentId) &&
    (!filters.practitionerId || encounterAttendingId(encounter) === filters.practitionerId) &&
    (!filters.nurseId || encounterNurseIds(encounter).includes(filters.nurseId))
  );
}

/** 特記事項セルの先頭に出す予定・外出泊のタグ。 */
function planTagLabels(encounter: fhir4.Encounter, date: string): string[] {
  const tags: string[] = [];
  const transfer = encounterTransferPlan(encounter);
  if (transfer) tags.push(`転科・転棟予定 ${transfer.date} ${transfer.wardName}`.trim());
  const discharge = encounterDischargePlan(encounter);
  if (discharge) tags.push(`退院予定 ${dateTimeLabel(discharge.at)}`);
  // 終わった外出泊まで並べると埋まるので、見ている日以降にかかるものだけ出す。
  for (const leave of encounterLeaves(encounter)) {
    if (leave.end && leave.end.slice(0, 10) < date) continue;
    tags.push(`外出泊 ${dateTimeLabel(leave.start)}〜${leave.end ? dateTimeLabel(leave.end) : "未定"}`);
  }
  return tags;
}

export function InpatientListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wardId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();
  const tabParam = searchParams.get("tab");
  const tab: TabKey = TABS.some((item) => item.key === tabParam)
    ? (tabParam as TabKey)
    : "current";
  // タブごとの日付の絞り込み。空なら日付では絞らない(基準日と違って既定は「すべて」)。
  // タブごとに別のパラメータで持つので、タブを行き来してもそれぞれの絞り込みが残る。
  const plannedDate = searchParams.get(DATE_PARAMS.planned) ?? "";
  const transferDate = searchParams.get(DATE_PARAMS.transfer) ?? "";
  const leaveFrom = searchParams.get(DATE_PARAMS.leaveFrom) ?? "";
  const leaveTo = searchParams.get(DATE_PARAMS.leaveTo) ?? "";
  const dischargePlanDate = searchParams.get(DATE_PARAMS.discharge) ?? "";
  // 退院患者タブが見る日。基準日と同じく必ず値を持つ(既定は今日)。
  const dischargedDate = searchParams.get(DATE_PARAMS.discharged) || today();

  // 表示中のタブに出す日付の絞り込み欄(日付を必ず持つタブには出さない)。
  const dateFields = isDatedTab(tab) ? [] : DATE_FILTERS[tab];

  // ward・date・tab とタブごとの日付は URL で一緒に持つので、一部だけ変えるときも
  // 他を残す。キーはそのままパラメータ名(日付はタブごとに違うので固定できない)。
  function setParams(next: Record<string, string>, replace = false) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace });
  }
  const [admissionTarget, setAdmissionTarget] = useState<{
    bed: fhir4.Location;
    roomName: string;
  } | null>(null);
  const [dischargeTarget, setDischargeTarget] = useState<InpatientRow | null>(null);
  const [rowAction, setRowAction] = useState<RowAction | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [executeTarget, setExecuteTarget] = useState<PlannedRow | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);

  // 列が多く、既定の幅では折り返すのでこの画面だけ幅を広げる
  // (外来患者一覧と同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const wardOptions = useWardOptions();
  const grid = useWardGrid(wardId || undefined);
  // 退院患者タブは「その日に退院した人」を出すので、検索そのものを退院日で行う
  // (退院日当日はまだ在院として引けるので、この検索結果に入ってくる)。
  const inpatients = useInpatientEncounters(tab === "discharged" ? dischargedDate : date);
  const planned = usePlannedAdmissions();
  const cancelAdmission = useCancelAdmission();
  // 未指示受けの件数(入院患者タブだけ)。病棟の指示簿一覧と同じキャッシュに乗る。
  const nursingPending = useNursingPendingCounts(
    tab === "current" ? date : "",
    tab === "current" ? wardId || undefined : undefined,
  );
  const updateEncounter = useUpdateEncounter();

  // 病棟が未指定なら先頭の病棟を開く。履歴を汚さないよう replace で書く。
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || wardId) return;
    const first = wardOptions.wards[0];
    if (!first?.id) return;
    initialized.current = true;
    setParams({ ward: first.id }, true);
    // setParams は searchParams に依存するが、初回に一度だけ動けばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardId, wardOptions.wards]);

  const byBed = inpatients.data?.byBed;
  const patientsById = inpatients.data?.patientsById;

  const filtering = Boolean(filters.departmentId || filters.practitionerId || filters.nurseId);
  // 入院患者タブ以外は日付でも絞れるので、「絞り込み中か」の判定が入院患者タブと違う。
  // filtering の方は入院患者タブで空床を出すかどうかの判定に使うので混ぜない。
  const tabFiltering = filtering || dateFields.some((field) => searchParams.get(field.param));
  const clearable = isDatedTab(tab) ? filtering : tabFiltering;

  function clearFilters() {
    setFilters(emptyFilters);
    // 日付は今のタブに出ているものだけ消す(他のタブのぶんはそのまま残す)。
    if (dateFields.length > 0) {
      setParams(Object.fromEntries(dateFields.map((field) => [field.param, ""])));
    }
  }

  const rows = useMemo<InpatientRow[]>(() => {
    const all = grid.rooms.flatMap((room) => {
      const beds = grid.bedsByRoom.get(room.id ?? "") ?? [];
      return beds.map((bed) => {
        const encounter = bed.id ? byBed?.get(bed.id) : undefined;
        const patientId = encounter ? encounterPatientId(encounter) : undefined;
        return {
          room,
          bed,
          encounter,
          patient: patientId ? patientsById?.get(patientId) : undefined,
        };
      });
    });

    // 診療科・主治医で絞るときは空床を出さない(空床はどちらも持たないので、
    // 残すと「絞ったのに一覧が変わらない」ように見えてしまう)。
    const visible = filtering
      ? all.filter((row) => row.encounter && matchesFilters(row.encounter, filters))
      : all;

    return withRoomRowSpans(visible);
  }, [grid.rooms, grid.bedsByRoom, byBed, patientsById, filtering, filters]);

  // 入院予定は選んだ病棟のぶんだけ、予定日順(取得時に整列済み)で出す。
  const plannedRows = useMemo<PlannedRow[]>(() => {
    const encounters = (planned.data?.encounters ?? []).filter(
      (encounter) =>
        plannedWardId(encounter) === wardId &&
        (!plannedDate || encounterAdmissionDate(encounter) === plannedDate) &&
        (!filtering || matchesFilters(encounter, filters)),
    );
    return encounters.map((encounter) => {
      const patientId = encounterPatientId(encounter);
      return {
        encounter,
        patient: patientId ? planned.data?.patientsById.get(patientId) : undefined,
      };
    });
  }, [planned.data, wardId, plannedDate, filtering, filters]);

  // 転科・転棟/外出泊/退院予定は、入院中の患者に付けた予定を予定の側から並べ直した
  // もの。もとの Encounter は入院患者タブと同じ検索結果なので取得は増やさない。
  // 退院済み(finished)にはこれらの予定を出す意味がないので在院中だけを見る。
  const admittedEncounters = useMemo(
    () =>
      (inpatients.data?.encounters ?? []).filter(
        (encounter) =>
          encounter.status === ADMISSION_STATUS &&
          (!filtering || matchesFilters(encounter, filters)),
      ),
    [inpatients.data, filtering, filters],
  );

  // 選択中の病棟のベッド id -> 病室名・ベッド名。外出泊・退院予定タブで
  // 「今どこに居るか」を出すのと、その病棟に居る人だけに絞るのに使う。
  const bedPlaceById = useMemo(() => {
    const map = new Map<string, { roomName: string; bedName: string }>();
    for (const room of grid.rooms) {
      const roomName = locationDisplayName(room);
      for (const bed of grid.bedsByRoom.get(room.id ?? "") ?? []) {
        if (bed.id) map.set(bed.id, { roomName, bedName: bedShortLabel(bed) });
      }
    }
    return map;
  }, [grid.rooms, grid.bedsByRoom]);

  const transferRows = useMemo<TransferPlanRow[]>(() => {
    const rows: TransferPlanRow[] = [];
    for (const encounter of admittedEncounters) {
      const plan = encounterTransferPlan(encounter);
      // 「移動先に指定されている病棟」に出すので、今どこに居るかでは絞らない。
      if (!plan || plan.wardId !== wardId) continue;
      if (transferDate && plan.date !== transferDate) continue;
      const patientId = encounterPatientId(encounter);
      rows.push({
        encounter,
        patient: patientId ? patientsById?.get(patientId) : undefined,
        plan,
      });
    }
    return rows.sort((a, b) => a.plan.date.localeCompare(b.plan.date));
  }, [admittedEncounters, wardId, transferDate, patientsById]);

  const leaveRows = useMemo<LeaveRow[]>(() => {
    const rows: LeaveRow[] = [];
    for (const encounter of admittedEncounters) {
      const bedId = encounterBedId(encounter);
      const place = bedId ? bedPlaceById.get(bedId) : undefined;
      // この病棟の床に居る人だけ。
      if (!place) continue;
      const patientId = encounterPatientId(encounter);
      const patient = patientId ? patientsById?.get(patientId) : undefined;
      for (const leave of encounterLeaves(encounter)) {
        // 済んだ外出泊は残さない(基準日より前に帰院しているもの)。
        if (leave.end && leave.end.slice(0, 10) < date) continue;
        if (leaveFrom && leave.start.slice(0, 10) !== leaveFrom) continue;
        if (leaveTo && leave.end.slice(0, 10) !== leaveTo) continue;
        rows.push({ encounter, patient, ...place, leave });
      }
    }
    return rows.sort((a, b) => a.leave.start.localeCompare(b.leave.start));
  }, [admittedEncounters, bedPlaceById, date, leaveFrom, leaveTo, patientsById]);

  const dischargeRows = useMemo<DischargePlanRow[]>(() => {
    const rows: DischargePlanRow[] = [];
    for (const encounter of admittedEncounters) {
      const plan = encounterDischargePlan(encounter);
      if (!plan) continue;
      if (dischargePlanDate && plan.at.slice(0, 10) !== dischargePlanDate) continue;
      const bedId = encounterBedId(encounter);
      const place = bedId ? bedPlaceById.get(bedId) : undefined;
      if (!place) continue;
      const patientId = encounterPatientId(encounter);
      rows.push({
        encounter,
        patient: patientId ? patientsById?.get(patientId) : undefined,
        ...place,
        plan,
      });
    }
    return rows.sort((a, b) => a.plan.at.localeCompare(b.plan.at));
  }, [admittedEncounters, bedPlaceById, dischargePlanDate, patientsById]);

  const dischargedRows = useMemo<DischargedRow[]>(() => {
    const rows: DischargedRow[] = [];
    for (const encounter of inpatients.data?.encounters ?? []) {
      if (encounter.status !== DISCHARGED_STATUS) continue;
      if (encounterDischargeDate(encounter) !== dischargedDate) continue;
      if (filtering && !matchesFilters(encounter, filters)) continue;
      const bedId = encounterBedId(encounter);
      // 退院したときに居た床で病棟を判定する。
      const place = bedId ? bedPlaceById.get(bedId) : undefined;
      if (!place) continue;
      const patientId = encounterPatientId(encounter);
      rows.push({
        encounter,
        patient: patientId ? patientsById?.get(patientId) : undefined,
        ...place,
      });
    }
    return rows.sort((a, b) => a.roomName.localeCompare(b.roomName, "ja"));
  }, [inpatients.data, dischargedDate, filtering, filters, bedPlaceById, patientsById]);

  // 選択肢は表示中のタブの Encounter から作る。病棟を切り替えても選択が
  // 消えないよう、表示中の病棟ではなく全病棟ぶんを見る。
  const optionSource = useMemo(
    () =>
      tab === "planned"
        ? (planned.data?.encounters ?? [])
        : (inpatients.data?.encounters ?? []),
    [tab, planned.data, inpatients.data],
  );
  const departmentOptions = useMemo(
    () =>
      filterOptions(optionSource, (e) => [
        { id: encounterDepartmentId(e), name: encounterDepartmentName(e) },
      ]),
    [optionSource],
  );
  const practitionerOptions = useMemo(
    () =>
      filterOptions(optionSource, (e) => [
        { id: encounterAttendingId(e), name: encounterAttendingName(e) },
      ]),
    [optionSource],
  );
  const nurseOptions = useMemo(
    () =>
      filterOptions(optionSource, (e) => {
        const ids = encounterNurseIds(e);
        return encounterNurseNames(e).map((name, index) => ({ id: ids[index], name }));
      }),
    [optionSource],
  );

  // 二重入院の警告用。どの患者がどの床に居るかを患者 id で引けるようにする。
  const admittedBedLabelByPatientId = useMemo(() => {
    const map = new Map<string, string>();
    for (const encounter of inpatients.data?.encounters ?? []) {
      const patientId = encounterPatientId(encounter);
      const label = encounter.location?.[0]?.location?.display;
      if (patientId && label) map.set(patientId, label);
    }
    return map;
  }, [inpatients.data]);

  // いま入院中の患者が居るベッド。転室・転床や入院実施で空床だけを選ばせる。
  const occupiedBedIds = useMemo(() => {
    const set = new Set<string>();
    for (const encounter of inpatients.data?.encounters ?? []) {
      if (encounter.status !== ADMISSION_STATUS) continue;
      const bedId = encounterBedId(encounter);
      if (bedId) set.add(bedId);
    }
    return set;
  }, [inpatients.data]);

  function handleCancelAdmission(row: InpatientRow) {
    if (!row.encounter) return;
    const label = row.patient ? displayName(row.patient) : "この患者";
    if (
      !window.confirm(
        `${label} の入院登録を取り消します。誤登録の取り消しなので退院の記録は残りません。よろしいですか?`,
      )
    ) {
      return;
    }
    cancelAdmission.mutate(row.encounter);
  }

  function handleCancelPlan(row: PlannedRow) {
    const label = row.patient ? displayName(row.patient) : "この患者";
    if (!window.confirm(`${label} の入院予定を取り消します。よろしいですか?`)) return;
    updateEncounter.mutate(buildPlanCancelledEncounter(row.encounter));
  }

  const occupied = rows.filter((row) => row.encounter).length;
  const beds = rows.length;
  const loading =
    wardOptions.isLoading ||
    grid.isLoading ||
    (tab === "planned" ? planned.isLoading : inpatients.isLoading);

  // 表はタブごとに列も操作も違うので、条件式を重ねずタブで分けて返す。
  function renderTable() {
    if (tab === "planned") {
      return (
        plannedRows.length === 0 ? (
          <p className="patient-table__empty">
            {tabFiltering
              ? "絞り込みに該当する入院予定がありません。"
              : "この病棟の入院予定はありません。"}
          </p>
        ) : (
          <>
            <div className="inpatient-wrap sticky-table-wrap">
              <table className="patient-table inpatient sticky-table">
                <thead>
                  <tr>
                    <th className="sticky-table__fix-1">病室</th>
                    <th className="sticky-table__fix-2">ベッド</th>
                    <th className="sticky-table__fix-3">患者氏名</th>
                    <PatientProfileHeadCells />
                    <th>診療科</th>
                    <th>主治医</th>
                    <th>担当看護師</th>
                    <th>入院予定日</th>
                    <th>特記事項</th>
                    <th className="sticky-table__fix-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {plannedRows.map((row) => (
                    <PlannedTableRow
                      key={row.encounter.id}
                      row={row}
                      onExecute={() => setExecuteTarget(row)}
                      onCancelPlan={() => handleCancelPlan(row)}
                      cancelling={updateEncounter.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="order-select__muted">入院予定 {plannedRows.length} 件</p>
          </>
        )
      );
    }
    if (tab === "transfer") {
      return (
        <TransferPlanTable
          rows={transferRows}
          filtering={tabFiltering}
          occupiedBedIds={occupiedBedIds}
        />
      );
    }
    if (tab === "leave") {
      return <LeaveTable rows={leaveRows} filtering={tabFiltering} />;
    }
    if (tab === "discharge") {
      return <DischargePlanTable rows={dischargeRows} filtering={tabFiltering} />;
    }
    if (tab === "discharged") {
      return (
        <DischargedTable
          rows={dischargedRows}
          filtering={filtering}
          occupiedBedIds={occupiedBedIds}
        />
      );
    }
    return (
      rows.length === 0 ? (
        <p className="patient-table__empty">
          {filtering
            ? "絞り込みに該当する入院患者がいません。"
            : "この病棟には病室・ベッドが登録されていません。"}
        </p>
      ) : (
        <>
          <div className="inpatient-wrap sticky-table-wrap">
            <table className="patient-table inpatient sticky-table">
              <thead>
                <tr>
                  <th className="sticky-table__fix-1">病室</th>
                  <th className="sticky-table__fix-2">ベッド</th>
                  <th className="sticky-table__fix-3">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th>診療科</th>
                  <th>主治医</th>
                  <th>担当看護師</th>
                  <th>入院日</th>
                  <th>特記事項</th>
                  <th className="sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <InpatientTableRow
                    key={row.bed.id}
                    row={row}
                    date={date}
                    onAdmit={() =>
                      setAdmissionTarget({
                        bed: row.bed,
                        roomName: locationDisplayName(row.room),
                      })
                    }
                    onDischarge={() => setDischargeTarget(row)}
                    onCancelAdmission={() => handleCancelAdmission(row)}
                    onRowAction={(kind) => setRowAction({ kind, row })}
                    cancelling={cancelAdmission.isPending}
                    pendingNursingCount={
                      nursingPending.countByPatientId.get(row.patient?.id ?? "") ?? 0
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted">
            {filtering
              ? `絞り込み結果 ${occupied} 件`
              : `${beds} 床中 ${occupied} 床が在院(空床 ${beds - occupied})`}
          </p>
        </>
      )
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>入院患者一覧</h1>
      </div>

      <form className="patient-search-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          病棟
          <select
            value={wardId}
            onChange={(e) => setParams({ ward: e.target.value })}
          >
            <option value="">選択してください</option>
            {wardOptions.wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {locationDisplayName(ward)}
              </option>
            ))}
          </select>
        </label>
        {tab === "current" && (
          <label>
            基準日
            <DateStepper value={date} onChange={(next) => setParams({ date: next })} />
          </label>
        )}
        {tab === "discharged" && (
          <label>
            退院日
            <DateStepper
              value={dischargedDate}
              onChange={(next) => setParams({ [DATE_PARAMS.discharged]: next })}
            />
          </label>
        )}
        {/* 予定はいつの日付にもあり得るので、既定は指定なし(すべて)。
            基準日のような日送りは付けない(送った先に予定が無いことの方が多い)。 */}
        {dateFields.map((field) => (
          <label key={field.param}>
            {field.label}
            <input
              type="date"
              value={searchParams.get(field.param) ?? ""}
              onChange={(e) => setParams({ [field.param]: e.target.value })}
            />
          </label>
        ))}
        <label>
          診療科
          <select
            value={filters.departmentId}
            onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })}
          >
            <option value="">すべて</option>
            {departmentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          主治医
          <select
            value={filters.practitionerId}
            onChange={(e) => setFilters({ ...filters, practitionerId: e.target.value })}
          >
            <option value="">すべて</option>
            {practitionerOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          担当看護師
          <select
            value={filters.nurseId}
            onChange={(e) => setFilters({ ...filters, nurseId: e.target.value })}
          >
            <option value="">すべて</option>
            {nurseOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <div className="patient-search-form__actions">
          <button
            type="button"
            onClick={clearFilters}
            disabled={!clearable}
          >
            クリア
          </button>
        </div>
      </form>

      <div className="inpatient-tabs" role="tablist" aria-label="入院の表示切替">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`inpatient-tabs__tab${tab === item.key ? " is-active" : ""}`}
            onClick={() => setParams({ tab: item.key === "current" ? "" : item.key })}
          >
            {item.label}
          </button>
        ))}
        {/* 病棟ぶんをまとめて指示受けするときはこちら(1 人ずつはバッジからカルテへ)。 */}
        {tab === "current" && wardId && (
          <Link
            className="button inpatient-tabs__link"
            to={`/nursing-worklist?ward=${wardId}&date=${date}`}
          >
            指示簿
          </Link>
        )}
      </div>

      <ErrorBanner
        error={wardOptions.error ?? grid.error ?? inpatients.error ?? planned.error}
      />
      <ErrorBanner error={cancelAdmission.error ?? updateEncounter.error} />
      <ErrorBanner error={nursingPending.error} />

      {(tab === "planned" ? planned.data?.truncated : inpatients.data?.truncated) && (
        <p className="error-banner__line error-banner__line--error" role="status">
          {tab === "planned"
            ? "入院予定が多いため、一部のみ表示しています。"
            : "入院中の患者が多いため、一部のみ表示しています。"}
        </p>
      )}

      {tab === "planned" && (
        <div className="inpatient__toolbar">
          <button type="button" onClick={() => setPlanModalOpen(true)}>
            新規登録
          </button>
        </div>
      )}

      {loading ? (
        <p>読み込み中...</p>
      ) : wardOptions.wards.length === 0 ? (
        <p className="patient-table__empty">
          病棟が登録されていません。マスタメンテ &gt; 共通 &gt; 病棟・病室 から登録してください。
        </p>
      ) : !wardId ? (
        <p className="patient-table__empty">病棟を選択してください。</p>
      ) : (
        renderTable()
      )}

      {admissionTarget && (
        <AdmissionModal
          bed={admissionTarget.bed}
          roomName={admissionTarget.roomName}
          // 過去の日を見ているときに今日で登録すると、登録した本人がその画面に
          // 出てこない。見ている日を入院日の既定にする。
          defaultAdmissionDate={date}
          admittedBedLabelByPatientId={admittedBedLabelByPatientId}
          onClose={() => setAdmissionTarget(null)}
        />
      )}

      {dischargeTarget?.encounter && (
        <DischargeModal
          encounter={dischargeTarget.encounter}
          patient={dischargeTarget.patient}
          bedLabel={bedDisplayName(
            dischargeTarget.bed,
            locationDisplayName(dischargeTarget.room),
          )}
          onClose={() => setDischargeTarget(null)}
        />
      )}

      {rowAction?.row.encounter && rowAction.kind === "bedTransfer" && (
        <BedTransferModal
          encounter={rowAction.row.encounter}
          patient={rowAction.row.patient}
          wardId={wardId}
          currentBedLabel={bedDisplayName(
            rowAction.row.bed,
            locationDisplayName(rowAction.row.room),
          )}
          occupiedBedIds={occupiedBedIds}
          onClose={() => setRowAction(null)}
        />
      )}

      {rowAction?.row.encounter && rowAction.kind === "leave" && (
        <LeaveModal
          encounter={rowAction.row.encounter}
          patient={rowAction.row.patient}
          onClose={() => setRowAction(null)}
        />
      )}

      {rowAction?.row.encounter && rowAction.kind === "transferPlan" && (
        <TransferPlanModal
          encounter={rowAction.row.encounter}
          patient={rowAction.row.patient}
          onClose={() => setRowAction(null)}
        />
      )}

      {rowAction?.row.encounter && rowAction.kind === "dischargePlan" && (
        <DischargePlanModal
          encounter={rowAction.row.encounter}
          patient={rowAction.row.patient}
          onClose={() => setRowAction(null)}
        />
      )}

      {planModalOpen && (
        <PlannedAdmissionModal
          defaultWardId={wardId || undefined}
          onClose={() => setPlanModalOpen(false)}
        />
      )}

      {executeTarget && (
        <AdmissionExecuteModal
          plan={executeTarget.encounter}
          patient={executeTarget.patient}
          occupiedBedIds={occupiedBedIds}
          admittedBedLabelByPatientId={admittedBedLabelByPatientId}
          onClose={() => setExecuteTarget(null)}
        />
      )}
    </div>
  );
}

function InpatientTableRow({
  row,
  date,
  onAdmit,
  onDischarge,
  onCancelAdmission,
  onRowAction,
  cancelling,
  pendingNursingCount,
}: {
  row: InpatientRow;
  date: string;
  /** 空床のケバブから入院登録を開く。 */
  onAdmit: () => void;
  onDischarge: () => void;
  onCancelAdmission: () => void;
  onRowAction: (kind: RowAction["kind"]) => void;
  cancelling: boolean;
  /** まだ看護師が受けていない看護指示の件数。0 なら出さない。 */
  pendingNursingCount: number;
}) {
  const returnLinkState = useReturnLinkState();
  const { room, bed, roomRowSpan, encounter, patient } = row;
  const patientId = patient?.id;
  const bedLabel = bedNumber(bed) ?? bed.name ?? "-";
  const note = encounter ? encounterNote(encounter) : "";
  const planTags = encounter ? planTagLabels(encounter, date) : [];

  return (
    <tr>
      {roomRowSpan > 0 && (
        <td rowSpan={roomRowSpan} className="inpatient__room sticky-table__fix-1">
          {locationDisplayName(room)}
        </td>
      )}
      <td className="sticky-table__fix-2">{bedLabel}</td>
      {encounter && patient ? (
        <>
          <td className="inpatient__name sticky-table__fix-3">
            {/* カナは列を分けず、氏名の後ろに小さめの括弧書きで添える。 */}
            {displayName(patient)}
            <PatientKana patient={patient} />
          </td>
          <PatientProfileCells patient={patient} />
          <td>{encounterDepartmentName(encounter)}</td>
          <td>{encounterAttendingName(encounter)}</td>
          <td>{encounterNurseNames(encounter).join("、") || "-"}</td>
          <td>{encounterAdmissionDate(encounter)}</td>
          <td className="inpatient__note">
            {/* 未指示受けは「掲示」ではなく要対応なので、予定タグ(枠線)と見た目を
                分けて先頭に置く。押すとその患者のカルテの指示簿タブが開く。 */}
            {pendingNursingCount > 0 && patientId && (
              <Link
                className="inpatient__order-tag"
                to={`/patients/${patientId}/karte?${KARTE_TAB_PARAM}=nursing`}
                state={returnLinkState}
              >
                指示受け {pendingNursingCount}
              </Link>
            )}
            {planTags.map((tag) => (
              <span key={tag} className="inpatient__plan-tag">
                {tag}
              </span>
            ))}
            {note ||
              (planTags.length === 0 && pendingNursingCount === 0 ? "-" : null)}
          </td>
          <td className="patient-table__actions sticky-table__fix-actions">
            {patientId && (
              <Link className="button" to={`/patients/${patientId}/karte`} state={returnLinkState}>
                カルテ
              </Link>
            )}
            {/* 表が横スクロールするので、メニューは escapesClipping で領域の外に出す
                (でないと縁で切れる)。 */}
            <RowMenu
              label={`${patient ? displayName(patient) : "この患者"} の操作`}
              escapesClipping
            >
              <button
                type="button"
                className="row-menu__item"
                onClick={() => onRowAction("bedTransfer")}
              >
                転室・転床
              </button>
              <button
                type="button"
                className="row-menu__item"
                onClick={() => onRowAction("leave")}
              >
                外出泊
              </button>
              <button
                type="button"
                className="row-menu__item"
                onClick={() => onRowAction("transferPlan")}
              >
                転科・転棟予定
              </button>
              <button
                type="button"
                className="row-menu__item"
                onClick={() => onRowAction("dischargePlan")}
              >
                退院予定
              </button>
              <button type="button" className="row-menu__item" onClick={onDischarge}>
                退院
              </button>
              <button
                type="button"
                className="row-menu__item row-menu__item--danger"
                onClick={onCancelAdmission}
                disabled={cancelling}
              >
                入院取消
              </button>
            </RowMenu>
          </td>
        </>
      ) : (
        <>
          {/* 「空床」は患者氏名の列に置く。固定する列を colSpan にまとめてしまうと、
              スクロールしたときに残りの列まで一緒に貼り付いてしまう。
              淡くするのはセルではなく文字(理由は App.css の .inpatient__empty-bed)。 */}
          <td className="sticky-table__fix-3">
            <span className="inpatient__empty-bed">空床</span>
          </td>
          <td colSpan={7}></td>
          <td className="patient-table__actions sticky-table__fix-actions">
            <RowMenu label={`${locationDisplayName(room)} ${bedLabel} の操作`} escapesClipping>
              <button type="button" className="row-menu__item" onClick={onAdmit}>
                入院登録
              </button>
            </RowMenu>
          </td>
        </>
      )}
    </tr>
  );
}

function PlannedTableRow({
  row,
  onExecute,
  onCancelPlan,
  cancelling,
}: {
  row: PlannedRow;
  onExecute: () => void;
  onCancelPlan: () => void;
  cancelling: boolean;
}) {
  const returnLinkState = useReturnLinkState();
  const { encounter, patient } = row;
  const patientId = patient?.id;

  return (
    <tr>
      <td className="inpatient__room sticky-table__fix-1">{plannedRoomName(encounter)}</td>
      <td className="sticky-table__fix-2">{plannedBedName(encounter)}</td>
      <td className="inpatient__name sticky-table__fix-3">
        {patient ? (
          <>
            {displayName(patient)}
            <PatientKana patient={patient} />
          </>
        ) : (
          (encounter.subject?.display ?? "-")
        )}
      </td>
      <PatientProfileCells patient={patient} />
      <td>{encounterDepartmentName(encounter)}</td>
      <td>{encounterAttendingName(encounter)}</td>
      <td>{encounterNurseNames(encounter).join("、") || "-"}</td>
      <td>{encounterAdmissionDate(encounter)}</td>
      <td className="inpatient__note">{encounterNote(encounter) || "-"}</td>
      <td className="patient-table__actions sticky-table__fix-actions">
        {patientId && (
          <Link className="button" to={`/patients/${patientId}/karte`} state={returnLinkState}>
            カルテ
          </Link>
        )}
        <RowMenu
          label={`${patient ? displayName(patient) : "この患者"} の操作`}
          escapesClipping
        >
          <button type="button" className="row-menu__item" onClick={onExecute}>
            入院実施
          </button>
          <button
            type="button"
            className="row-menu__item row-menu__item--danger"
            onClick={onCancelPlan}
            disabled={cancelling}
          >
            入院予定取消
          </button>
        </RowMenu>
      </td>
    </tr>
  );
}
