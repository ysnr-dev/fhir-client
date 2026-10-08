import { csvBlob } from "../lib/csv";
import { dateTimeLabel, diffDays, localDay } from "../lib/dates";
import { admissionRouteDisplay, encounterAdmissionRoute } from "./admissionRouteHelpers";
import {
  appointmentDepartmentLabel,
  appointmentVisitKind,
  isWalkInAppointment,
  visitKindLabel,
} from "./appointmentHelpers";
import {
  arrivalModeLabel,
  dispositionLabel,
  emergencyArrivalMode,
  emergencyAttendingName,
  emergencyBedName,
  emergencyComplaint,
  emergencyDisposition,
  emergencyExamStartedAt,
  emergencyStatusLabel,
  emergencyTriageLevel,
  jtasLabel,
} from "./emergencyEncounterHelpers";
import {
  dischargeDispositionDisplay,
  encounterDischargeDisposition,
  encounterNote,
  encounterNurseNames,
} from "./encounterHelpers";
import {
  patientCell,
  patientColumnLabel,
  patientColumnsOf,
  patientRowOf,
  type ExtractOutput,
  type ExtractPatientRow,
} from "./extractQueryHelpers";

// 入院・外来の抽出(docs/data-extract-design.md §19)。入院 1 件・外来受診 1 件・救急受診 1 件を 1 行にする。
// 入院は在院日数・病棟・入院経路・退院先、外来は受付の診療科・初再診・診察の時刻、救急は来院から退室までの時刻と
// JTAS・来院方法・転帰・主訴を列にする。

export interface EncounterExtractRow extends ExtractPatientRow {
  rowKey: string;
  start: string;
  /** 折り返さない列(見出しは encounterExtractHeaders)。 */
  fixed: string[];
  /** 折り返す列。 */
  values: string[];
}

const INPATIENT_FIXED = [
  "入院日",
  "退院日",
  "在院日数",
  "状態",
  "診療科",
  "病棟",
  "病室・ベッド",
  "主治医",
  "入院経路",
  "予定・緊急",
  "救急車",
  "紹介",
  "退院先",
];
const INPATIENT_VALUES = ["担当看護師", "メモ"];
const OUTPATIENT_FIXED = ["受診日", "開始", "終了", "診察時間(分)", "状態", "診療科", "初再診", "当日受付", "担当医", "診察室"];
const EMERGENCY_FIXED = [
  "来院日",
  "来院",
  "トリアージ",
  "診察開始",
  "退室",
  "来院から診察まで(分)",
  "滞在時間(分)",
  "状態",
  "JTAS",
  "来院方法",
  "転帰",
  "担当医",
  "処置ベッド",
];
const EMERGENCY_VALUES = ["主訴"];

type EncounterKind = "inpatient" | "outpatient" | "emergency";

function referenceIdOf(reference: string | undefined, type: string): string {
  return reference?.startsWith(`${type}/`) ? reference.slice(type.length + 1) : "";
}

function attendingName(encounter: fhir4.Encounter): string {
  const participant = encounter.participant?.find((p) =>
    p.type?.some((t) => t.coding?.some((c) => c.code === "ATND")),
  );
  return participant?.individual?.display ?? "";
}

/** ベッドから partOf を 2 段たどった病室と病棟。 */
function bedPlace(
  encounter: fhir4.Encounter,
  locations: Map<string, fhir4.Location>,
): { room: fhir4.Location | undefined; ward: fhir4.Location | undefined } {
  const bed = locations.get(referenceIdOf(encounter.location?.[0]?.location?.reference, "Location"));
  const room = locations.get(referenceIdOf(bed?.partOf?.reference, "Location"));
  const ward = locations.get(referenceIdOf(room?.partOf?.reference, "Location"));
  return { room, ward };
}

/** 病室・ベッドの表示。入院登録で合成した表示に病室名が無ければ(ベッド名だけなら)病室名を前に足す。 */
function bedLabel(encounter: fhir4.Encounter, room: fhir4.Location | undefined): string {
  const display = encounter.location?.[0]?.location?.display ?? "";
  const roomName = room?.name ?? "";
  return roomName && !display.includes(roomName) ? `${roomName} ${display}`.trim() : display;
}

/** 入院日から退院日(入院中は今日)までの日数。入院日を 1 日目として退院日も数える。 */
function stayDays(start: string, end: string, today: string): string {
  if (!start) return "";
  return String(diffDays(start, end || today) + 1);
}

function minutesBetween(from: string | undefined, to: string | undefined): string {
  if (!from || !to || from.length <= 10 || to.length <= 10) return "";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) && ms >= 0 ? String(Math.round(ms / 60000)) : "";
}

function inpatientRow(
  encounter: fhir4.Encounter,
  locations: Map<string, fhir4.Location>,
  today: string,
): Pick<EncounterExtractRow, "fixed" | "values"> {
  const start = localDay(encounter.period?.start);
  const end = localDay(encounter.period?.end);
  const route = encounterAdmissionRoute(encounter);
  const routeLabels = admissionRouteDisplay(route);
  const { room, ward } = bedPlace(encounter, locations);
  return {
    fixed: [
      start,
      end,
      stayDays(start, end, today),
      encounter.status === "finished" ? "退院" : "入院中",
      encounter.serviceProvider?.display ?? "",
      ward?.name ?? "",
      bedLabel(encounter, room),
      attendingName(encounter),
      routeLabels.route ?? "",
      routeLabels.admissionType ?? "",
      route.ambulance ? "あり" : "",
      route.referral ? "あり" : "",
      dischargeDispositionDisplay(encounterDischargeDisposition(encounter)),
    ],
    values: [encounterNurseNames(encounter).join("、"), encounterNote(encounter)],
  };
}

function outpatientRow(
  encounter: fhir4.Encounter,
  appointments: Map<string, fhir4.Appointment>,
): Pick<EncounterExtractRow, "fixed" | "values"> {
  const appointment = appointments.get(referenceIdOf(encounter.appointment?.[0]?.reference, "Appointment"));
  const status = encounter.status === "finished" ? "診察済" : encounter.status === "in-progress" ? "診察中" : encounter.status;
  return {
    fixed: [
      localDay(encounter.period?.start),
      dateTimeLabel(encounter.period?.start).slice(11, 16),
      dateTimeLabel(encounter.period?.end).slice(11, 16),
      minutesBetween(encounter.period?.start, encounter.period?.end),
      status,
      appointment ? appointmentDepartmentLabel(appointment) : "",
      appointment ? visitKindLabel(appointmentVisitKind(appointment)) : "",
      appointment && isWalkInAppointment(appointment) ? "当日" : "",
      attendingName(encounter),
      encounter.location?.[0]?.location?.display ?? "",
    ],
    values: [],
  };
}

/** 時刻「HH:mm」。来院日と日付が違えば(日をまたいだ滞在)日付も添える。 */
function clockOn(value: string | undefined, day: string): string {
  if (!value) return "";
  const label = dateTimeLabel(value);
  return label.slice(0, 10) === day ? label.slice(11, 16) : label.slice(5);
}

/** トリアージの時刻。「来院」の状態を抜けた時刻(statusHistory の来院の期間の終わり)。 */
function triagedAt(encounter: fhir4.Encounter): string | undefined {
  return (encounter.statusHistory ?? []).find((h) => h.status === "arrived")?.period.end;
}

function emergencyRow(encounter: fhir4.Encounter): Pick<EncounterExtractRow, "fixed" | "values"> {
  const start = encounter.period?.start;
  const day = localDay(start);
  const examAt = emergencyExamStartedAt(encounter);
  const level = emergencyTriageLevel(encounter);
  return {
    fixed: [
      day,
      clockOn(start, day),
      clockOn(triagedAt(encounter), day),
      clockOn(examAt, day),
      clockOn(encounter.period?.end, day),
      minutesBetween(start, examAt),
      minutesBetween(start, encounter.period?.end),
      emergencyStatusLabel(encounter.status),
      level === undefined ? "" : `${level} ${jtasLabel(level)}`,
      arrivalModeLabel(emergencyArrivalMode(encounter)),
      dispositionLabel(emergencyDisposition(encounter)),
      emergencyAttendingName(encounter),
      emergencyBedName(encounter),
    ],
    values: [emergencyComplaint(encounter)],
  };
}

/** 入院・外来受診・救急受診を表の行にする。行は開始の新しい順。 */
export function encounterExtractRows(
  kind: EncounterKind,
  encounters: fhir4.Encounter[],
  locations: Map<string, fhir4.Location>,
  appointments: Map<string, fhir4.Appointment>,
  patients: Map<string, fhir4.Patient>,
  today: string,
): EncounterExtractRow[] {
  const rows = encounters.map((encounter): EncounterExtractRow => {
    const patientId = encounter.subject?.reference?.split("/").pop() ?? "";
    return {
      ...patientRowOf(patientId, patients.get(patientId)),
      rowKey: encounter.id ?? "",
      start: encounter.period?.start ?? "",
      ...(kind === "inpatient"
        ? inpatientRow(encounter, locations, today)
        : kind === "outpatient"
          ? outpatientRow(encounter, appointments)
          : emergencyRow(encounter)),
    };
  });
  return rows.sort(
    (a, b) =>
      b.start.localeCompare(a.start) ||
      a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }),
  );
}

const HEADERS: Record<EncounterKind, string[]> = {
  inpatient: [...INPATIENT_FIXED, ...INPATIENT_VALUES],
  outpatient: OUTPATIENT_FIXED,
  emergency: [...EMERGENCY_FIXED, ...EMERGENCY_VALUES],
};

export function encounterExtractHeader(kind: EncounterKind, output: ExtractOutput | undefined): string[] {
  return ["患者番号", "氏名", ...patientColumnsOf(output).map(patientColumnLabel), ...HEADERS[kind]];
}

export function encounterExtractCsv(
  kind: EncounterKind,
  rows: EncounterExtractRow[],
  output: ExtractOutput | undefined,
): Blob {
  const patientColumns = patientColumnsOf(output);
  return csvBlob(
    encounterExtractHeader(kind, output),
    rows.map((row) => [
      row.patientNumber,
      row.name,
      ...patientColumns.map((column) => patientCell(row, column)),
      ...row.fixed,
      ...row.values,
    ]),
  );
}
