// 予約枠(Schedule / Slot)の組み立て・復元。
//
//   Schedule … 「誰の / どこの枠か」を表す枠表。actor(1..*)に担当医(Practitioner)と
//               診察室(Location)を持ち、planningHorizon でその枠表が有効な期間を示す。
//   Slot     … 枠表にぶら下がる個々の時間枠。空きかどうかは status が持つ。
//
// R4 の Schedule には名称の要素が無いため、枠の呼び名(「午前一般外来」など)は
// serviceType[0].text に入れる。診療科は specialty に SS-MIX2 統一診療科コードで持つ。
//
// 枠の生成に使った曜日パターン(月水金 9:00-12:00、15分刻み …)は R4 の標準要素に
// 置き場が無いので extension に JSON で持たせる。翌月ぶんを同じ条件で作り直せる
// ようにするためで、Slot の内容そのものは常に Slot リソース側が正。
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { SSMIX2_DEPARTMENT_CODE_SYSTEM } from "./departmentCodes";

const SLOT_PATTERN_EXT_URL = "http://fhir-client.local/StructureDefinition/schedule-slot-pattern";
const SERVICE_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/schedule-service-type";

// 予約種別は HL7 v2-0276(ROUTINE / WALKIN / CHECKUP …)を使う。Slot と
// Appointment で同じ値セットを共有する。
export const APPOINTMENT_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0276";

export const APPOINTMENT_TYPE_OPTIONS = [
  { code: "ROUTINE", label: "通常" },
  { code: "CHECKUP", label: "健診" },
  { code: "FOLLOWUP", label: "再診" },
  { code: "WALKIN", label: "当日受付" },
  { code: "EMERGENCY", label: "救急" },
] as const;

export function appointmentTypeLabel(code: string | undefined): string {
  if (!code) return "-";
  return APPOINTMENT_TYPE_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

// ---- Slot の状態 ----

export const SLOT_STATUS_OPTIONS = [
  { code: "free", label: "空き" },
  { code: "busy", label: "予約済" },
  { code: "busy-tentative", label: "仮予約" },
  { code: "busy-unavailable", label: "停止" },
  { code: "entered-in-error", label: "誤登録" },
] as const;

export type SlotStatus = (typeof SLOT_STATUS_OPTIONS)[number]["code"];

export function slotStatusLabel(status: string | undefined): string {
  if (!status) return "-";
  return SLOT_STATUS_OPTIONS.find((o) => o.code === status)?.label ?? status;
}

/** 予約が入っている枠は消せない・止められない(予約側の取消が先)。 */
export function isBookedSlot(slot: fhir4.Slot): boolean {
  return slot.status === "busy" || slot.status === "busy-tentative";
}

// ---- 曜日パターン ----

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export interface SlotTimeBlock {
  /** "09:00" 形式。 */
  start: string;
  /** "12:00" 形式。 */
  end: string;
}

export interface SlotPattern {
  /** 0=日 … 6=土。JavaScript の Date#getDay と同じ並び。 */
  weekdays: number[];
  blocks: SlotTimeBlock[];
  /** 1 枠の長さ(分)。 */
  durationMinutes: number;
  appointmentTypeCode: string;
}

export const emptySlotPattern: SlotPattern = {
  weekdays: [1, 2, 3, 4, 5],
  blocks: [
    { start: "09:00", end: "12:00" },
    { start: "14:00", end: "17:00" },
  ],
  durationMinutes: 15,
  appointmentTypeCode: "ROUTINE",
};

export function validateSlotPattern(pattern: SlotPattern): string | null {
  if (pattern.weekdays.length === 0) return "曜日を 1 つ以上選んでください。";
  if (pattern.blocks.length === 0) return "時間帯を 1 つ以上入力してください。";
  if (!Number.isFinite(pattern.durationMinutes) || pattern.durationMinutes <= 0) {
    return "1 枠の長さは 1 分以上で入力してください。";
  }
  for (const block of pattern.blocks) {
    if (!block.start || !block.end) return "時間帯の開始・終了を入力してください。";
    if (minutesOf(block.end) <= minutesOf(block.start)) {
      return "時間帯の終了は開始より後の時刻にしてください。";
    }
    if (minutesOf(block.end) - minutesOf(block.start) < pattern.durationMinutes) {
      return "時間帯の長さが 1 枠の長さより短くなっています。";
    }
  }
  return null;
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function timeOf(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// ---- 日付ユーティリティ(すべてローカル時刻の "YYYY-MM-DD" で扱う) ----

export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function today(): string {
  return toDateInput(new Date());
}

export function addDays(dateISO: string, days: number): string {
  const date = new Date(`${dateISO}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

/** その日を含む週の月曜日。カレンダーは月曜始まりで表示する。 */
export function weekStart(dateISO: string): string {
  const date = new Date(`${dateISO}T00:00:00`);
  // getDay() は 0=日。月曜を週頭にするので日曜は 6 日戻す。
  const offset = (date.getDay() + 6) % 7;
  return addDays(dateISO, -offset);
}

/** 週頭から 7 日ぶんの日付。 */
export function weekDates(weekStartISO: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStartISO, i));
}

export function formatDateLabel(dateISO: string): string {
  const date = new Date(`${dateISO}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_LABELS[date.getDay()]})`;
}

/** Slot.start(タイムゾーン付き instant)からローカルの "YYYY-MM-DD"。 */
export function slotDate(slot: fhir4.Slot): string {
  return toDateInput(new Date(slot.start));
}

/** Slot.start からローカルの "HH:mm"。 */
export function slotTime(slot: fhir4.Slot): string {
  const date = new Date(slot.start);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---- Schedule ----

export interface ScheduleFormValues {
  /** 枠の呼び名。serviceType[0].text に入る。 */
  name: string;
  /** 担当医の Practitioner.id。診察室とどちらか一方は必須。 */
  practitionerId: string;
  /** 診察室の Location.id。 */
  locationId: string;
  /** SS-MIX2 統一診療科コード。任意。 */
  departmentCode: string;
  departmentName: string;
  /** planningHorizon。"YYYY-MM-DD"。 */
  horizonStart: string;
  horizonEnd: string;
  active: boolean;
  comment: string;
  pattern: SlotPattern;
}

export const emptyScheduleForm: ScheduleFormValues = {
  name: "",
  practitionerId: "",
  locationId: "",
  departmentCode: "",
  departmentName: "",
  horizonStart: "",
  horizonEnd: "",
  active: true,
  comment: "",
  pattern: emptySlotPattern,
};

export function validateScheduleForm(values: ScheduleFormValues): string | null {
  if (!values.name.trim()) return "枠の名称は必須です。";
  // Schedule.actor は 1..*。上流も actor 無しは 422 で弾く。
  if (!values.practitionerId && !values.locationId) {
    return "担当医と診察室のどちらか一方は必ず選んでください。";
  }
  if (!values.horizonStart || !values.horizonEnd) return "有効期間は必須です。";
  if (values.horizonEnd < values.horizonStart) {
    return "有効期間の終了日は開始日以降にしてください。";
  }
  return validateSlotPattern(values.pattern);
}

export function buildSchedule(
  values: ScheduleFormValues,
  actorNames: { practitioner?: string; location?: string },
  id?: string,
): fhir4.Schedule {
  const actor: fhir4.Reference[] = [];
  if (values.practitionerId) {
    actor.push({
      reference: `Practitioner/${values.practitionerId}`,
      display: actorNames.practitioner,
    });
  }
  if (values.locationId) {
    actor.push({ reference: `Location/${values.locationId}`, display: actorNames.location });
  }

  const schedule: fhir4.Schedule = {
    resourceType: "Schedule",
    active: values.active,
    actor,
    serviceType: [
      {
        coding: [{ system: SERVICE_TYPE_SYSTEM, code: "outpatient", display: "外来枠" }],
        text: values.name.trim(),
      },
    ],
    planningHorizon: {
      // 期間は日単位で押さえる。instant ではないが、上流は dateTime として
      // 検証するのでタイムゾーンは必要。
      start: toFhirDateTime(`${values.horizonStart}T00:00`),
      end: toFhirDateTime(`${values.horizonEnd}T23:59`),
    },
    extension: [{ url: SLOT_PATTERN_EXT_URL, valueString: JSON.stringify(values.pattern) }],
  };

  if (id) schedule.id = id;
  if (values.comment.trim()) schedule.comment = values.comment.trim();

  if (values.departmentCode) {
    schedule.specialty = [
      {
        coding: [
          {
            system: SSMIX2_DEPARTMENT_CODE_SYSTEM,
            code: values.departmentCode,
            display: values.departmentName || undefined,
          },
        ],
        text: values.departmentName || undefined,
      },
    ];
  }

  return schedule;
}

export function parseSchedule(schedule: fhir4.Schedule): ScheduleFormValues {
  const specialty = schedule.specialty?.[0]?.coding?.find(
    (c) => c.system === SSMIX2_DEPARTMENT_CODE_SYSTEM,
  );

  return {
    name: scheduleName(schedule),
    practitionerId: actorId(schedule, "Practitioner"),
    locationId: actorId(schedule, "Location"),
    departmentCode: specialty?.code ?? "",
    departmentName: specialty?.display ?? schedule.specialty?.[0]?.text ?? "",
    horizonStart: dateOnly(schedule.planningHorizon?.start),
    horizonEnd: dateOnly(schedule.planningHorizon?.end),
    active: schedule.active ?? true,
    comment: schedule.comment ?? "",
    pattern: slotPatternOf(schedule) ?? emptySlotPattern,
  };
}

function dateOnly(value: string | undefined): string {
  return value ? value.slice(0, 10) : "";
}

export function actorId(schedule: fhir4.Schedule, resourceType: string): string {
  const reference = schedule.actor?.find((a) => a.reference?.startsWith(`${resourceType}/`));
  return reference?.reference?.split("/").pop() ?? "";
}

export function actorDisplay(schedule: fhir4.Schedule, resourceType: string): string {
  return schedule.actor?.find((a) => a.reference?.startsWith(`${resourceType}/`))?.display ?? "";
}

export function scheduleName(schedule: fhir4.Schedule): string {
  return schedule.serviceType?.[0]?.text || "(名称未設定)";
}

/** 一覧やカレンダーの見出しに使う「名称 / 担当医・診察室」。 */
export function scheduleSummary(schedule: fhir4.Schedule): string {
  const actors = [actorDisplay(schedule, "Practitioner"), actorDisplay(schedule, "Location")]
    .filter(Boolean)
    .join(" / ");
  return actors ? `${scheduleName(schedule)}(${actors})` : scheduleName(schedule);
}

export function schedulePeriodLabel(schedule: fhir4.Schedule): string {
  const start = dateOnly(schedule.planningHorizon?.start);
  const end = dateOnly(schedule.planningHorizon?.end);
  if (!start && !end) return "-";
  return `${start || "-"} 〜 ${end || "-"}`;
}

/** extension に保存した曜日パターン。壊れた JSON は無視して既定値に落とす。 */
export function slotPatternOf(schedule: fhir4.Schedule): SlotPattern | null {
  const value = schedule.extension?.find((e) => e.url === SLOT_PATTERN_EXT_URL)?.valueString;
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SlotPattern;
    if (!Array.isArray(parsed.weekdays) || !Array.isArray(parsed.blocks)) return null;
    return {
      weekdays: parsed.weekdays,
      blocks: parsed.blocks,
      durationMinutes: parsed.durationMinutes || emptySlotPattern.durationMinutes,
      appointmentTypeCode: parsed.appointmentTypeCode || "ROUTINE",
    };
  } catch {
    return null;
  }
}

// ---- Slot の生成 ----

export interface SlotGenerateRange {
  /** "YYYY-MM-DD"。両端を含む。 */
  from: string;
  to: string;
}

/**
 * 曜日パターンから Slot を組み立てる。既存 Slot と開始時刻が重なるものは作らない
 * (同じ期間に対して二度実行しても増えないようにするため)。
 * 時間帯の端数(15分刻みで 09:00-09:50 の最後の 10 分など)は切り捨てる。
 */
export function generateSlots(
  scheduleId: string,
  pattern: SlotPattern,
  range: SlotGenerateRange,
  existingSlots: fhir4.Slot[],
): fhir4.Slot[] {
  const taken = new Set(existingSlots.map((slot) => new Date(slot.start).getTime()));
  const weekdays = new Set(pattern.weekdays);
  const slots: fhir4.Slot[] = [];

  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T00:00:00`).getDay();
    if (!weekdays.has(weekday)) continue;

    for (const block of pattern.blocks) {
      const blockEnd = minutesOf(block.end);
      for (
        let start = minutesOf(block.start);
        start + pattern.durationMinutes <= blockEnd;
        start += pattern.durationMinutes
      ) {
        const startAt = toFhirDateTime(`${date}T${timeOf(start)}`);
        if (taken.has(new Date(startAt).getTime())) continue;
        taken.add(new Date(startAt).getTime());
        slots.push(buildSlot(scheduleId, startAt, toFhirDateTime(`${date}T${timeOf(start + pattern.durationMinutes)}`), pattern.appointmentTypeCode));
      }
    }
  }

  return slots;
}

function buildSlot(
  scheduleId: string,
  start: string,
  end: string,
  appointmentTypeCode: string,
): fhir4.Slot {
  const slot: fhir4.Slot = {
    resourceType: "Slot",
    schedule: { reference: `Schedule/${scheduleId}` },
    status: "free",
    start,
    end,
  };

  if (appointmentTypeCode) {
    slot.appointmentType = {
      coding: [
        {
          system: APPOINTMENT_TYPE_SYSTEM,
          code: appointmentTypeCode,
          display: appointmentTypeLabel(appointmentTypeCode),
        },
      ],
    };
  }

  return slot;
}

/** 生成した Slot をまとめて登録する transaction Bundle。 */
export function buildSlotCreateBundle(slots: fhir4.Slot[]): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: slots.map((slot) => ({
      resource: slot,
      request: { method: "POST" as const, url: "Slot" },
    })),
  };
}

/** 枠をまとめて削除する transaction Bundle。 */
export function buildSlotDeleteBundle(slots: fhir4.Slot[]): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: slots
      .filter((slot) => slot.id)
      .map((slot) => ({
        request: { method: "DELETE" as const, url: `Slot/${slot.id}` },
      })),
  };
}

// ---- 週カレンダーの組み立て ----

export interface SlotCalendarCell {
  date: string;
  slot: fhir4.Slot | undefined;
}

export interface SlotCalendarRow {
  /** "09:00"。行の見出し。 */
  time: string;
  cells: SlotCalendarCell[];
}

/**
 * 週の Slot を「行=開始時刻 / 列=曜日」の表にする。時刻の行は、その週に実在する
 * 開始時刻だけを昇順に並べる(枠のない時間帯で表が間延びしないようにする)。
 */
export function buildSlotCalendar(slots: fhir4.Slot[], weekStartISO: string): SlotCalendarRow[] {
  const dates = weekDates(weekStartISO);
  const byKey = new Map<string, fhir4.Slot>();
  const times = new Set<string>();

  for (const slot of slots) {
    const time = slotTime(slot);
    times.add(time);
    byKey.set(`${slotDate(slot)}T${time}`, slot);
  }

  return [...times]
    .sort()
    .map((time) => ({
      time,
      cells: dates.map((date) => ({ date, slot: byKey.get(`${date}T${time}`) })),
    }));
}
