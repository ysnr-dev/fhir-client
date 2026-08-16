// 予約(Appointment)の組み立て・復元。
//
// 予約は「枠(Slot)を押さえること」なので、Appointment を作る/取り消すときは必ず
// Slot の status も一緒に動かす。両者がずれると、埋まっているのに空きに見える枠や、
// 誰も予約していないのに埋まっている枠ができる。そのため書き込みはすべて
// transaction Bundle にして、片方だけが通ることを防ぐ。
//
// なお Bundle の中の PUT には If-Match が付かないので、二人が同じ枠を同時に押さえる
// 取り合いまでは防げない。1 施設で予約を取る端末が限られる前提で今回は許容している。
import type { ProblemRef } from "./conditionHelpers";
import { displayName } from "./patientHelpers";
import {
  APPOINTMENT_TYPE_SYSTEM,
  DEFAULT_APPOINTMENT_TYPE,
  appointmentTypeLabel,
  scheduleName,
  slotDate,
  slotTime,
  toDateInput,
} from "./scheduleHelpers";

export const APPOINTMENT_STATUS_OPTIONS = [
  { code: "proposed", label: "提案" },
  { code: "pending", label: "承諾待ち" },
  { code: "booked", label: "予約済" },
  { code: "arrived", label: "来院" },
  { code: "checked-in", label: "受付済" },
  { code: "fulfilled", label: "診療済" },
  { code: "cancelled", label: "取消" },
  { code: "noshow", label: "未来院" },
  { code: "waitlist", label: "キャンセル待ち" },
  { code: "entered-in-error", label: "誤登録" },
] as const;

export function appointmentStatusLabel(status: string | undefined): string {
  if (!status) return "-";
  return APPOINTMENT_STATUS_OPTIONS.find((o) => o.code === status)?.label ?? status;
}

/** 取り消せる予約(まだ来院・診療が済んでいないもの)。 */
export function isActiveAppointment(appointment: fhir4.Appointment): boolean {
  return ["proposed", "pending", "booked", "arrived", "checked-in", "waitlist"].includes(
    appointment.status,
  );
}

export interface AppointmentFormValues {
  comment: string;
}

export const emptyAppointmentForm: AppointmentFormValues = {
  comment: "",
};

/**
 * 予約 1 件。日時・担当医・診察室は押さえた枠(Slot)と枠表(Schedule)から埋めるので、
 * 画面で入力するのは予約種別とメモだけ。
 */
export function buildAppointment(
  values: AppointmentFormValues,
  patient: fhir4.Patient,
  schedule: fhir4.Schedule,
  slot: fhir4.Slot,
  problem?: ProblemRef,
  id?: string,
): fhir4.Appointment {
  const practitioner = schedule.actor?.find((a) => a.reference?.startsWith("Practitioner/"));
  const location = schedule.actor?.find((a) => a.reference?.startsWith("Location/"));

  // participant の先頭は必ず患者。上流はここから患者を索引しており、これが無いと
  // 患者コンパートメント(Patient/$everything やカルテの検索)に入らない。
  const participant: fhir4.AppointmentParticipant[] = [
    {
      actor: { reference: `Patient/${patient.id}`, display: displayName(patient) },
      required: "required",
      status: "accepted",
    },
  ];
  if (practitioner) {
    participant.push({ actor: practitioner, required: "required", status: "accepted" });
  }
  if (location) {
    participant.push({ actor: location, required: "required", status: "accepted" });
  }

  const appointment: fhir4.Appointment = {
    resourceType: "Appointment",
    status: "booked",
    appointmentType: {
      coding: [
        {
          system: APPOINTMENT_TYPE_SYSTEM,
          code: DEFAULT_APPOINTMENT_TYPE,
          display: appointmentTypeLabel(DEFAULT_APPOINTMENT_TYPE),
        },
      ],
    },
    description: scheduleName(schedule),
    // app-2: start と end は「両方あるか両方無いか」。枠から取るので必ず両方入る。
    start: slot.start,
    end: slot.end,
    minutesDuration: minutesBetween(slot.start, slot.end),
    slot: [{ reference: `Slot/${slot.id}` }],
    participant,
  };

  if (id) appointment.id = id;

  if (schedule.serviceType) appointment.serviceType = schedule.serviceType;
  if (schedule.specialty) appointment.specialty = schedule.specialty;
  if (values.comment.trim()) appointment.comment = values.comment.trim();

  // 何のための受診かを残す。他のオーダーの reasonReference と同じ扱い。
  if (problem?.conditionId) {
    appointment.reasonReference = [
      { reference: `Condition/${problem.conditionId}`, display: problem.display },
    ];
  }

  return appointment;
}

function minutesBetween(start: string, end: string): number | undefined {
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
  return Math.round((to - from) / 60_000);
}

// ---- 書き込み(Appointment と Slot は必ず同じ transaction で動かす) ----

function slotEntry(slot: fhir4.Slot, status: fhir4.Slot["status"]): fhir4.BundleEntry {
  const updated: fhir4.Slot = { ...slot, status };
  return {
    resource: updated,
    request: { method: "PUT", url: `Slot/${slot.id}` },
  };
}

/** 予約を取る。押さえた枠は busy にする。 */
export function buildBookBundle(appointment: fhir4.Appointment, slot: fhir4.Slot): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { resource: appointment, request: { method: "POST", url: "Appointment" } },
      slotEntry(slot, "busy"),
    ],
  };
}

/**
 * 予約を取り消す。押さえていた枠は空きに戻す。
 * app-4 により cancelationReason は cancelled / noshow のときだけ持てる。
 */
export function buildCancelBundle(
  appointment: fhir4.Appointment,
  slots: fhir4.Slot[],
): fhir4.Bundle {
  const cancelled: fhir4.Appointment = { ...appointment, status: "cancelled" };

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        resource: cancelled,
        request: { method: "PUT", url: `Appointment/${appointment.id}` },
      },
      ...slots.map((slot) => slotEntry(slot, "free")),
    ],
  };
}

/** 日時を変える。古い枠を空きに戻し、新しい枠を押さえ、予約の日時を差し替える。 */
export function buildRescheduleBundle(
  appointment: fhir4.Appointment,
  oldSlots: fhir4.Slot[],
  newSlot: fhir4.Slot,
): fhir4.Bundle {
  const moved: fhir4.Appointment = {
    ...appointment,
    start: newSlot.start,
    end: newSlot.end,
    minutesDuration: minutesBetween(newSlot.start, newSlot.end),
    slot: [{ reference: `Slot/${newSlot.id}` }],
  };

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { resource: moved, request: { method: "PUT", url: `Appointment/${appointment.id}` } },
      // 同じ枠に取り直した場合に free で上書きしないよう、古い枠から新しい枠を除く。
      ...oldSlots.filter((slot) => slot.id !== newSlot.id).map((slot) => slotEntry(slot, "free")),
      slotEntry(newSlot, "busy"),
    ],
  };
}

// ---- 表示 ----

export function appointmentSlotIds(appointment: fhir4.Appointment): string[] {
  return (appointment.slot ?? [])
    .map((ref) => ref.reference?.split("/").pop())
    .filter((id): id is string => Boolean(id));
}

export function appointmentActorDisplay(
  appointment: fhir4.Appointment,
  resourceType: string,
): string {
  return actorReference(appointment, resourceType)?.display ?? "";
}

export function appointmentActorId(appointment: fhir4.Appointment, resourceType: string): string {
  return actorReference(appointment, resourceType)?.reference?.split("/").pop() ?? "";
}

function actorReference(
  appointment: fhir4.Appointment,
  resourceType: string,
): fhir4.Reference | undefined {
  return appointment.participant?.find((p) => p.actor?.reference?.startsWith(`${resourceType}/`))
    ?.actor;
}

/** 予約が引き継いでいる診療科コード(SS-MIX2)。日時変更で枠表を絞る初期値に使う。 */
export function appointmentDepartmentCode(appointment: fhir4.Appointment): string {
  return appointment.specialty?.[0]?.coding?.[0]?.code ?? "";
}

/** 「2026-08-19(水) 09:00〜09:15」。 */
export function appointmentDateTimeLabel(appointment: fhir4.Appointment): string {
  if (!appointment.start) return "-";
  const start = new Date(appointment.start);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][start.getDay()];
  const time = appointment.start.slice(11, 16);
  const endTime = appointment.end ? `〜${appointment.end.slice(11, 16)}` : "";
  return `${toDateInput(start)}(${weekday}) ${time}${endTime}`;
}

/** 新しい予約が上に来る並び(過去の予約は下)。 */
export function sortAppointmentsByStartDesc(
  appointments: fhir4.Appointment[],
): fhir4.Appointment[] {
  return [...appointments].sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
}

export function appointmentScheduleLabel(appointment: fhir4.Appointment): string {
  return appointment.serviceType?.[0]?.text || appointment.description || "-";
}

// ---- 枠選択(月カレンダー) ----

/** "2026-08" のような月の指定。 */
export function currentMonth(): string {
  return toDateInput(new Date()).slice(0, 7);
}

export function shiftMonth(month: string, diff: number): string {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(year, mon - 1 + diff, 1);
  return toDateInput(date).slice(0, 7);
}

export function monthRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split("-").map(Number);
  return {
    from: toDateInput(new Date(year, mon - 1, 1)),
    // 月末を含めたいので翌月 1 日。呼び出し側は start=lt で使う。
    to: toDateInput(new Date(year, mon, 1)),
  };
}

export function monthLabel(month: string): string {
  const [year, mon] = month.split("-");
  return `${year}年${Number(mon)}月`;
}

export interface MonthCell {
  date: string;
  /** その月の日か(前後月のはみ出しは薄く出す)。 */
  inMonth: boolean;
}

/** 月曜始まりで 6 週ぶん(42 日)。行数を固定して月送りで高さが変わらないようにする。 */
export function monthGrid(month: string): MonthCell[][] {
  const [year, mon] = month.split("-").map(Number);
  const first = new Date(year, mon - 1, 1);
  // getDay() は 0=日。月曜を週頭にするので日曜は 6 日戻す。
  const start = new Date(year, mon - 1, 1 - ((first.getDay() + 6) % 7));

  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day);
      return { date: toDateInput(date), inMonth: date.getMonth() === mon - 1 };
    }),
  );
}

/** 日付 → その日の空き枠数。月カレンダーのセルに出す。 */
export function freeCountByDate(slots: fhir4.Slot[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slot of slots) {
    if (slot.status !== "free") continue;
    const date = slotDate(slot);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return counts;
}

export interface SlotTimeGroup {
  /** "09:00"。 */
  time: string;
  endTime: string;
  total: number;
  free: number;
  /** 押さえる対象。空きのうち先頭の 1 件を使う。 */
  freeSlots: fhir4.Slot[];
}

/** その日の枠を開始時刻でまとめる。定員が複数ある枠は 1 行にまとまる。 */
export function groupSlotsByTime(slots: fhir4.Slot[]): SlotTimeGroup[] {
  const groups = new Map<string, fhir4.Slot[]>();
  for (const slot of slots) {
    if (slot.status === "entered-in-error") continue;
    const time = slotTime(slot);
    const group = groups.get(time);
    if (group) group.push(slot);
    else groups.set(time, [slot]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, group]) => ({
      time,
      endTime: group[0].end?.slice(11, 16) ?? "",
      total: group.length,
      free: group.filter((slot) => slot.status === "free").length,
      freeSlots: group.filter((slot) => slot.status === "free"),
    }));
}
