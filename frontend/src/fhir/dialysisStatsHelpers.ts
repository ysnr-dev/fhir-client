import { addDays, addMonths, clockTime, localDay, WEEKDAY_LABELS, weekdayOf } from "../lib/dates";
import { dialysisAppointmentBedId, dialysisAppointmentShift } from "./dialysisAppointmentHelpers";
import {
  DIALYSIS_MODALITY_OPTIONS,
  DIALYSIS_MODALITY_SYSTEM,
  dialysisModalityShort,
} from "./dialysisOrderHelpers";
import { dialysisActualMinutes, dialysisHubAppointmentId, isDialysisProcedure } from "./dialysisResultHelpers";
import { dialysisShiftAt, type DialysisShift } from "./dialysisShiftHelpers";
import { dialysisBoardBedLabel, type DialysisBoardBed } from "./dialysisUnitHelpers";
import { SETTING_SYSTEM } from "./prescriptionHelpers";
import { slotDate, slotTime } from "./scheduleHelpers";
import { categoryCoding, codingBySystem, referenceIdOfType } from "./shared";

// 透析の月間統計(docs/dialysis-order-design.md §6.3)。その月に始めた回(実施記録のハブ)と、
// 透析室の枠・予約から、回数・浄化方法別・シフト別とベッド別の稼働・日別を出す。
//
// - 実施 = その月に開始した回(終了・中断・透析中)。入室だけの回は数えない。
// - 枠   = 有効なベッドの枠(停止と誤登録を除く)。
// - 稼働率 = 透析室で実施した回 ÷ 枠。ベッドサイドの回は枠を使わないので別に数える。

/** 予約として数える status(取消を除く)。未来院も予約の内に数え、別にも出す。 */
export const DIALYSIS_STATS_APPOINTMENT_STATUSES = "booked,arrived,checked-in,fulfilled,noshow";

const PERFORMED_STATUSES = new Set(["completed", "stopped", "in-progress"]);

/** シフトに当たらない回・枠(シフトを消した、時刻を手で動かした)。 */
const OTHER_SHIFT = "other";
const BEDSIDE = "bedside";

export function dialysisMonthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}

export interface DialysisStatsInput {
  month: string;
  hubs: readonly fhir4.Procedure[];
  ordersById: ReadonlyMap<string, fhir4.ServiceRequest>;
  appointments: readonly fhir4.Appointment[];
  slots: readonly fhir4.Slot[];
  beds: readonly DialysisBoardBed[];
  shifts: readonly DialysisShift[];
}

export interface DialysisStatsSummary {
  sessions: number;
  patients: number;
  inpatient: number;
  outpatient: number;
  /** 終了した回の実透析時間の平均(分)。 */
  averageMinutes?: number;
  slots: number;
  booked: number;
  noshow: number;
  /** 透析室で実施した回。 */
  unitSessions: number;
  bedside: number;
  rate?: number;
}

export interface DialysisModalityStats {
  code: string;
  label: string;
  sessions: number;
  patients: number;
  inpatient: number;
  outpatient: number;
  averageMinutes?: number;
}

export interface DialysisCapacityStats {
  key: string;
  label: string;
  slots: number;
  booked: number;
  noshow: number;
  sessions: number;
  rate?: number;
}

export interface DialysisDayStats {
  date: string;
  weekday: string;
  /** シフトのコード(とその他)→ 実施・枠。 */
  byShift: Record<string, { sessions: number; slots: number }>;
  bedside: number;
  sessions: number;
  slots: number;
  rate?: number;
}

export interface DialysisMonthlyStats {
  summary: DialysisStatsSummary;
  byModality: DialysisModalityStats[];
  /** シフトの順。シフトに当たらないものは「その他」、ベッドサイドは末尾。 */
  byShift: DialysisCapacityStats[];
  byBed: DialysisCapacityStats[];
  byDay: DialysisDayStats[];
  /** 日別の列に出すシフト(その他を含む)。 */
  dayColumns: { key: string; label: string }[];
}

interface SessionFact {
  patientId: string;
  day: string;
  modality: string;
  setting: string;
  minutes: number | null;
  /** 透析室の回はシフト、ベッドサイドは BEDSIDE。 */
  shift: string;
  bedId: string;
}

function rateOf(sessions: number, slots: number): number | undefined {
  return slots > 0 ? sessions / slots : undefined;
}

function average(values: number[]): number | undefined {
  return values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : undefined;
}

function shiftOfTime(shifts: readonly DialysisShift[], time: string): string {
  return (time && dialysisShiftAt(shifts, time)?.code) || OTHER_SHIFT;
}

function sessionFacts(input: DialysisStatsInput, from: string, to: string): SessionFact[] {
  const appointmentsById = new Map(input.appointments.flatMap((a) => (a.id ? [[a.id, a] as const] : [])));
  return input.hubs.flatMap((hub) => {
    if (!isDialysisProcedure(hub) || hub.partOf?.length || !PERFORMED_STATUSES.has(hub.status)) return [];
    const start = hub.performedPeriod?.start;
    const day = localDay(start);
    if (!day || day < from || day > to) return [];
    const order = input.ordersById.get(referenceIdOfType(hub.basedOn?.[0]?.reference, "ServiceRequest"));
    const appointmentId = dialysisHubAppointmentId(hub);
    const appointment = appointmentsById.get(appointmentId);
    let shift = BEDSIDE;
    if (appointment) shift = dialysisAppointmentShift(appointment, input.shifts)?.code ?? OTHER_SHIFT;
    else if (appointmentId) shift = shiftOfTime(input.shifts, start ? clockTime(start) : "");
    return [
      {
        patientId: referenceIdOfType(hub.subject?.reference, "Patient"),
        day,
        modality: codingBySystem(hub.code?.coding, DIALYSIS_MODALITY_SYSTEM)?.code ?? "",
        setting: (order && categoryCoding(order, SETTING_SYSTEM)?.code) ?? "",
        minutes:
          hub.status === "in-progress" ? null : dialysisActualMinutes(start ?? "", hub.performedPeriod?.end ?? ""),
        shift,
        bedId: appointment ? dialysisAppointmentBedId(appointment) : "",
      },
    ];
  });
}

function modalityRows(facts: SessionFact[]): DialysisModalityStats[] {
  const known = DIALYSIS_MODALITY_OPTIONS.map((option) => option.code as string);
  const codes = [...new Set(facts.map((fact) => fact.modality))].sort(
    (a, b) => (known.indexOf(a) + 1 || 99) - (known.indexOf(b) + 1 || 99),
  );
  return codes.map((code) => {
    const own = facts.filter((fact) => fact.modality === code);
    return {
      code,
      label: dialysisModalityShort(code) || "不明",
      sessions: own.length,
      patients: new Set(own.map((fact) => fact.patientId)).size,
      inpatient: own.filter((fact) => fact.setting === "inpatient").length,
      outpatient: own.filter((fact) => fact.setting === "outpatient").length,
      averageMinutes: average(own.flatMap((fact) => (fact.minutes != null ? [fact.minutes] : []))),
    };
  });
}

export function buildDialysisMonthlyStats(input: DialysisStatsInput): DialysisMonthlyStats {
  const { from, to } = dialysisMonthRange(input.month);
  const facts = sessionFacts(input, from, to);
  const unitFacts = facts.filter((fact) => fact.shift !== BEDSIDE);

  const bedIdBySchedule = new Map(
    input.beds.flatMap((entry) => (entry.schedule?.id ? [[entry.schedule.id, entry.bed.id ?? ""] as const] : [])),
  );
  const slots = input.slots.flatMap((slot) => {
    if (slot.status === "entered-in-error" || slot.status === "busy-unavailable") return [];
    const day = slotDate(slot);
    if (day < from || day > to) return [];
    const scheduleId = referenceIdOfType(slot.schedule.reference, "Schedule");
    return [{ day, shift: shiftOfTime(input.shifts, slotTime(slot)), bedId: bedIdBySchedule.get(scheduleId) ?? "" }];
  });
  const appointments = input.appointments.flatMap((appointment) => {
    const day = localDay(appointment.start);
    if (!day || day < from || day > to || appointment.status === "cancelled") return [];
    return [
      {
        day,
        shift: dialysisAppointmentShift(appointment, input.shifts)?.code ?? OTHER_SHIFT,
        bedId: dialysisAppointmentBedId(appointment),
        noshow: appointment.status === "noshow",
      },
    ];
  });

  const capacity = (
    key: string,
    label: string,
    match: (row: { shift: string; bedId: string }) => boolean,
  ): DialysisCapacityStats => {
    const sessions = facts.filter(match).length;
    const slotCount = slots.filter(match).length;
    const own = appointments.filter(match);
    return {
      key,
      label,
      slots: slotCount,
      booked: own.length,
      noshow: own.filter((a) => a.noshow).length,
      sessions,
      rate: rateOf(sessions, slotCount),
    };
  };

  const shiftKeys = input.shifts.map((shift) => ({ key: shift.code, label: shift.label }));
  const hasOther = [...facts, ...slots, ...appointments].some((row) => row.shift === OTHER_SHIFT);
  const dayColumns = hasOther ? [...shiftKeys, { key: OTHER_SHIFT, label: "その他" }] : shiftKeys;
  const byShift = dayColumns.map(({ key, label }) => capacity(key, label, (row) => row.shift === key));
  const bedside = facts.length - unitFacts.length;
  if (bedside > 0) byShift.push(capacity(BEDSIDE, "ベッドサイド", (row) => row.shift === BEDSIDE));

  const withUnit = new Set(input.beds.map((entry) => entry.unit.id)).size > 1;
  const byBed = input.beds.map((entry) =>
    capacity(entry.bed.id ?? "", dialysisBoardBedLabel(entry, withUnit), (row) => row.bedId === entry.bed.id),
  );
  const knownBeds = new Set(input.beds.map((entry) => entry.bed.id));
  const strayBed = (row: { shift: string; bedId: string }) => row.shift !== BEDSIDE && !knownBeds.has(row.bedId);
  if (unitFacts.some(strayBed) || appointments.some(strayBed)) {
    byBed.push(capacity("other", "その他(無効なベッドなど)", strayBed));
  }

  const byDay: DialysisDayStats[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const dayFacts = facts.filter((fact) => fact.day === date);
    const daySlots = slots.filter((slot) => slot.day === date);
    const dayUnit = dayFacts.filter((fact) => fact.shift !== BEDSIDE).length;
    const weekday = weekdayOf(date);
    byDay.push({
      date,
      weekday: weekday == null ? "" : WEEKDAY_LABELS[weekday],
      byShift: Object.fromEntries(
        dayColumns.map(({ key }) => [
          key,
          {
            sessions: dayFacts.filter((fact) => fact.shift === key).length,
            slots: daySlots.filter((slot) => slot.shift === key).length,
          },
        ]),
      ),
      bedside: dayFacts.length - dayUnit,
      sessions: dayFacts.length,
      slots: daySlots.length,
      rate: rateOf(dayUnit, daySlots.length),
    });
  }

  return {
    summary: {
      sessions: facts.length,
      patients: new Set(facts.map((fact) => fact.patientId)).size,
      inpatient: facts.filter((fact) => fact.setting === "inpatient").length,
      outpatient: facts.filter((fact) => fact.setting === "outpatient").length,
      averageMinutes: average(facts.flatMap((fact) => (fact.minutes != null ? [fact.minutes] : []))),
      slots: slots.length,
      booked: appointments.length,
      noshow: appointments.filter((a) => a.noshow).length,
      unitSessions: unitFacts.length,
      bedside,
      rate: rateOf(unitFacts.length, slots.length),
    },
    byModality: modalityRows(facts),
    byShift,
    byBed,
    byDay,
    dayColumns,
  };
}

/** 表の合計行。稼働率はベッドサイドの回を除いて枠で割る。 */
export function capacityTotal(rows: readonly DialysisCapacityStats[]): Omit<DialysisCapacityStats, "key" | "label"> {
  const sum = (pick: (row: DialysisCapacityStats) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const slots = sum((row) => row.slots);
  return {
    slots,
    booked: sum((row) => row.booked),
    noshow: sum((row) => row.noshow),
    sessions: sum((row) => row.sessions),
    rate: rateOf(sum((row) => (row.key === BEDSIDE ? 0 : row.sessions)), slots),
  };
}

/** 「85.0%」。枠が無ければ「-」。 */
export function rateLabel(rate: number | undefined): string {
  return rate == null ? "-" : `${(rate * 100).toFixed(1)}%`;
}

