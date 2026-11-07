// 受診歴(プロファイルタブの「受診歴」区画)の行を Encounter から組み立てる。
//
// 入院・外来・救急は別の一覧で別の組み立て方をしているが、受診歴では 1 本の時系列に並べる。
// 外来の Encounter は診療科を持たないので、もとの予約(Appointment.specialty)から引く。

import { appointmentDepartmentLabel } from "./appointmentHelpers";
import {
  ADMISSION_CLASS_CODE,
  DISCHARGED_STATUS,
  encounterAttendingName,
  encounterBedLabel,
  PLAN_CANCELLED_STATUS,
  PLANNED_STATUS,
} from "./encounterHelpers";
import {
  dispositionLabel,
  emergencyComplaint,
  emergencyDisposition,
  EMERGENCY_CANCELLED_STATUS,
  EMERGENCY_CLASS_CODE,
  emergencyStatusLabel,
} from "./emergencyEncounterHelpers";
import {
  EXAM_IN_PROGRESS_STATUS,
  EXAM_PAUSED_STATUS,
  OUTPATIENT_CLASS_CODE,
  outpatientEncounterAppointmentId,
} from "./outpatientEncounterHelpers";
import { diffDays, localDay } from "../lib/dates";

/** 受診として数えない status(予定のまま・予定の取消・誤登録)。 */
export const ENCOUNTER_HISTORY_EXCLUDED_STATUSES = [
  PLANNED_STATUS,
  PLAN_CANCELLED_STATUS,
  EMERGENCY_CANCELLED_STATUS,
];

export type EncounterHistoryKind = "inpatient" | "outpatient" | "emergency" | "other";

export const ENCOUNTER_HISTORY_FILTERS: { key: EncounterHistoryKind | "all"; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "inpatient", label: "入院" },
  { key: "outpatient", label: "外来" },
  { key: "emergency", label: "救急" },
];

export interface EncounterHistoryRow {
  id: string;
  kind: EncounterHistoryKind;
  kindLabel: string;
  /** タイムラインで開く日(開始日)。 */
  day: string;
  /** 「2026-08-22 〜 2026-09-01(11日間)」のような期間の表示。外来・救急は開始日だけ。 */
  period: string;
  /** 入院中・診察中・転帰など、いまの状態。診察が終わった外来は空。 */
  status: string;
  /** 診療科・担当医・場所をつないだもの。 */
  meta: string;
  /** 救急の主訴。 */
  note: string;
}

function kindOf(encounter: fhir4.Encounter): EncounterHistoryKind {
  switch (encounter.class?.code) {
    case ADMISSION_CLASS_CODE:
      return "inpatient";
    case OUTPATIENT_CLASS_CODE:
      return "outpatient";
    case EMERGENCY_CLASS_CODE:
      return "emergency";
    default:
      return "other";
  }
}

const KIND_LABELS: Record<Exclude<EncounterHistoryKind, "other">, string> = {
  inpatient: "入院",
  outpatient: "外来",
  emergency: "救急",
};

// 入院日を 1 日目と数える(hospitalDayOf と同じ)。
function inpatientPeriod(start: string, end: string, todayDay: string): string {
  if (!start) return "-";
  if (end) return `${start} 〜 ${end}(${diffDays(start, end) + 1}日間)`;
  return `${start} 〜(${diffDays(start, todayDay) + 1}日目)`;
}

function outpatientStatus(encounter: fhir4.Encounter): string {
  if (encounter.status === EXAM_IN_PROGRESS_STATUS) return "診察中";
  if (encounter.status === EXAM_PAUSED_STATUS) return "一時終了";
  return "";
}

function statusOf(encounter: fhir4.Encounter, kind: EncounterHistoryKind): string {
  if (kind === "inpatient") return encounter.status === DISCHARGED_STATUS ? "退院" : "入院中";
  if (kind === "outpatient") return outpatientStatus(encounter);
  if (kind === "emergency") {
    return dispositionLabel(emergencyDisposition(encounter)) || emergencyStatusLabel(encounter.status);
  }
  return "";
}

function departmentOf(encounter: fhir4.Encounter, appointment: fhir4.Appointment | undefined): string {
  return encounter.serviceProvider?.display ?? (appointment ? appointmentDepartmentLabel(appointment) : "");
}

/** 受診歴の行。渡された順(上流の新しい順)のまま返す。 */
export function encounterHistoryRows(
  encounters: fhir4.Encounter[],
  appointments: fhir4.Appointment[],
  todayDay: string,
): EncounterHistoryRow[] {
  const appointmentsById = new Map(appointments.map((appointment) => [appointment.id, appointment]));
  return encounters.map((encounter) => {
    const kind = kindOf(encounter);
    const day = localDay(encounter.period?.start);
    const appointmentId = outpatientEncounterAppointmentId(encounter);
    const appointment = appointmentId ? appointmentsById.get(appointmentId) : undefined;
    return {
      id: encounter.id ?? "",
      kind,
      kindLabel: kind === "other" ? (encounter.class?.display ?? encounter.class?.code ?? "") : KIND_LABELS[kind],
      day,
      period:
        kind === "inpatient" ? inpatientPeriod(day, localDay(encounter.period?.end), todayDay) : day || "-",
      status: statusOf(encounter, kind),
      meta: [departmentOf(encounter, appointment), encounterAttendingName(encounter), encounterBedLabel(encounter)]
        .filter((value) => value && value !== "-")
        .join(" ・ "),
      note: kind === "emergency" ? emergencyComplaint(encounter) : "",
    };
  });
}
