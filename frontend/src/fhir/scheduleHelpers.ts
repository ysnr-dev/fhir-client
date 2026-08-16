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
import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
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

/**
 * 予約種別は画面では選ばせず「通常」で固定する。枠(Slot)と予約(Appointment)の
 * 双方で使う。区別が要るようになったらフォームに戻す。
 */
export const DEFAULT_APPOINTMENT_TYPE = "ROUTINE";

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
  /**
   * 同じ時間に受けられる人数。R4 の Slot に定員の要素は無い(overbooked は
   * 「既に定員超過している」フラグで人数ではない)ため、「30 分枠で 3 人まで」は
   * 同じ start / end の Slot を 3 件作って表す。1 Slot = 1 予約という R4 の
   * 想定どおりなので、空き数は status=free の件数を数えるだけで済み、
   * 予約の排他も Slot 単位の楽観ロックがそのまま効く。
   */
  capacity: number;
}

export const emptySlotPattern: SlotPattern = {
  weekdays: [1, 2, 3, 4, 5],
  blocks: [
    { start: "09:00", end: "12:00" },
    { start: "14:00", end: "17:00" },
  ],
  durationMinutes: 15,
  capacity: 1,
};

export function validateSlotPattern(pattern: SlotPattern): string | null {
  if (pattern.weekdays.length === 0) return "曜日を 1 つ以上選んでください。";
  if (pattern.blocks.length === 0) return "時間帯を 1 つ以上入力してください。";
  if (!Number.isFinite(pattern.durationMinutes) || pattern.durationMinutes <= 0) {
    return "1 枠の長さは 1 分以上で入力してください。";
  }
  if (!Number.isFinite(pattern.capacity) || pattern.capacity < 1) {
    return "同時に受けられる人数は 1 人以上で入力してください。";
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

export function addMonths(dateISO: string, months: number): string {
  const date = new Date(`${dateISO}T00:00:00`);
  date.setMonth(date.getMonth() + months);
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

/**
 * 枠表の種別。診察予約(外来の診察)と検査予約(CT・MRI など撮影室の枠)を分ける。
 * serviceType[0].coding のコードで持ち、予約を取る画面の絞り込みに使う。
 *   診察予約 … カルテ右ペインの予約登録から。定員(同時に受ける人数)を持てる
 *   検査予約 … 放射線オーダーの予約から。1 枠 1 予約(定員 1 固定)
 */
export type ScheduleType = "consultation" | "exam";

export const SCHEDULE_TYPE_OPTIONS: { code: ScheduleType; label: string }[] = [
  { code: "consultation", label: "診察予約" },
  { code: "exam", label: "検査予約" },
];

export function scheduleTypeLabel(type: ScheduleType): string {
  return SCHEDULE_TYPE_OPTIONS.find((o) => o.code === type)?.label ?? type;
}

/**
 * 枠表の種別。種別を持たない頃のデータ(coding が "outpatient")や不明値は
 * 診察予約として読む。
 */
export function scheduleTypeOf(schedule: fhir4.Schedule): ScheduleType {
  const code = schedule.serviceType?.[0]?.coding?.find(
    (c) => c.system === SERVICE_TYPE_SYSTEM,
  )?.code;
  return code === "exam" ? "exam" : "consultation";
}

export interface ScheduleFormValues {
  /** 枠の呼び名。serviceType[0].text に入る。 */
  name: string;
  scheduleType: ScheduleType;
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
  scheduleType: "consultation",
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
  // 有効期間は任意(未入力なら無期限)。両方入れたときだけ前後関係を見る。
  if (values.horizonStart && values.horizonEnd && values.horizonEnd < values.horizonStart) {
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

  // 検査予約は 1 枠 1 予約。画面でも定員入力を出さないが、保存時にも 1 に倒して
  // 矛盾したパターンを残さない。
  const pattern: SlotPattern =
    values.scheduleType === "exam" ? { ...values.pattern, capacity: 1 } : values.pattern;

  const schedule: fhir4.Schedule = {
    resourceType: "Schedule",
    active: values.active,
    actor,
    serviceType: [
      {
        coding: [
          {
            system: SERVICE_TYPE_SYSTEM,
            code: values.scheduleType,
            display: scheduleTypeLabel(values.scheduleType),
          },
        ],
        text: values.name.trim(),
      },
    ],
    extension: [{ url: SLOT_PATTERN_EXT_URL, valueString: JSON.stringify(pattern) }],
  };

  // 有効期間は任意。未入力なら planningHorizon ごと持たせず「無期限の枠表」にする
  // (R4 でも planningHorizon は 0..1 で、無ければ期間の定めが無い意味になる)。
  // 期間は日単位で押さえる。instant ではないが、上流は dateTime として検証するので
  // タイムゾーンは必要。
  if (values.horizonStart || values.horizonEnd) {
    schedule.planningHorizon = {};
    if (values.horizonStart) {
      schedule.planningHorizon.start = toFhirDateTime(`${values.horizonStart}T00:00`);
    }
    if (values.horizonEnd) {
      schedule.planningHorizon.end = toFhirDateTime(`${values.horizonEnd}T23:59`);
    }
  }

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
    scheduleType: scheduleTypeOf(schedule),
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

/** 「2026-08-17 〜 2026-09-30」。片側だけの指定もあり、両方無ければ無期限。 */
export function schedulePeriodLabel(schedule: fhir4.Schedule): string {
  const start = dateOnly(schedule.planningHorizon?.start);
  const end = dateOnly(schedule.planningHorizon?.end);
  if (!start && !end) return "無期限";
  return `${start} 〜 ${end}`;
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
      // capacity を持たない頃に作った枠表は 1 人枠として読む。
      capacity: parsed.capacity || 1,
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
 * 曜日パターンから Slot を組み立てる。同じ開始時刻の既存 Slot が定員に足りている
 * 分は作らない(同じ期間に対して二度実行しても増えず、定員を 2 → 3 に増やしたときは
 * 不足の 1 件だけが増える)。
 * 時間帯の端数(15分刻みで 09:00-09:50 の最後の 10 分など)は切り捨てる。
 */
export function generateSlots(
  scheduleId: string,
  pattern: SlotPattern,
  range: SlotGenerateRange,
  existingSlots: fhir4.Slot[],
): fhir4.Slot[] {
  // 誤登録(entered-in-error)は席として数えない。残っていても作り直せるようにする。
  const counts = new Map<number, number>();
  for (const slot of existingSlots) {
    if (slot.status === "entered-in-error") continue;
    const at = new Date(slot.start).getTime();
    counts.set(at, (counts.get(at) ?? 0) + 1);
  }

  const weekdays = new Set(pattern.weekdays);
  const capacity = Math.max(1, Math.floor(pattern.capacity));
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
        const endAt = toFhirDateTime(`${date}T${timeOf(start + pattern.durationMinutes)}`);
        const at = new Date(startAt).getTime();

        for (let seat = counts.get(at) ?? 0; seat < capacity; seat++) {
          slots.push(buildSlot(scheduleId, startAt, endAt));
        }
        counts.set(at, Math.max(counts.get(at) ?? 0, capacity));
      }
    }
  }

  return slots;
}

function buildSlot(scheduleId: string, start: string, end: string): fhir4.Slot {
  return {
    resourceType: "Slot",
    schedule: { reference: `Schedule/${scheduleId}` },
    status: "free",
    start,
    end,
    appointmentType: {
      coding: [
        {
          system: APPOINTMENT_TYPE_SYSTEM,
          code: DEFAULT_APPOINTMENT_TYPE,
          display: appointmentTypeLabel(DEFAULT_APPOINTMENT_TYPE),
        },
      ],
    },
  };
}

/**
 * 日時を直接指定して枠を作る(臨時枠の個別追加)。曜日パターンと違って既存の枠は
 * 見ないので、同じ日時に足せば席が増える(「この時間だけもう 1 人受ける」)。
 * 終了時刻は Date で足すので、日をまたぐ枠(23:30 から 60 分など)も正しく出る。
 */
export function buildSlotsAt(
  scheduleId: string,
  date: string,
  time: string,
  durationMinutes: number,
  count: number,
): fhir4.Slot[] {
  const startLocal = `${date}T${time}`;
  const endAt = new Date(new Date(`${startLocal}:00`).getTime() + durationMinutes * 60_000);
  const start = toFhirDateTime(startLocal);
  const end = toFhirDateTime(toDateTimeInput(endAt));

  return Array.from({ length: count }, () => buildSlot(scheduleId, start, end));
}

/** 個別追加のフォーム。 */
export interface SlotAddValues {
  date: string;
  time: string;
  durationMinutes: number;
  count: number;
}

export function validateSlotAdd(values: SlotAddValues): string | null {
  if (!values.date) return "日付を入力してください。";
  if (!values.time) return "開始時刻を入力してください。";
  if (!Number.isFinite(values.durationMinutes) || values.durationMinutes < 1) {
    return "枠の長さは 1 分以上で入力してください。";
  }
  if (!Number.isFinite(values.count) || values.count < 1) {
    return "追加する人数は 1 人以上で入力してください。";
  }
  return null;
}

/** その日時に既にある枠(誤登録を除く)。個別追加のときに件数を知らせるのに使う。 */
export function slotsAt(slots: fhir4.Slot[], date: string, time: string): fhir4.Slot[] {
  return slots.filter(
    (slot) =>
      slot.status !== "entered-in-error" && slotDate(slot) === date && slotTime(slot) === time,
  );
}

/** 枠表の有効期間の中か。外でも作れるが(臨時枠)、画面では注意を出す。 */
export function isWithinHorizon(schedule: fhir4.Schedule, date: string): boolean {
  const start = schedule.planningHorizon?.start?.slice(0, 10);
  const end = schedule.planningHorizon?.end?.slice(0, 10);
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
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
  /** その日時の枠。定員 3 の枠表なら 3 件並ぶ。 */
  slots: fhir4.Slot[];
}

export interface SlotCalendarRow {
  /** "09:00"。行の見出し。 */
  time: string;
  cells: SlotCalendarCell[];
}

/**
 * 週の Slot を「行=開始時刻 / 列=曜日」の表にする。時刻の行は、その週に実在する
 * 開始時刻だけを昇順に並べる(枠のない時間帯で表が間延びしないようにする)。
 * 1 セルには同じ日時の Slot がすべて入る(定員 = セル内の件数)。
 */
export function buildSlotCalendar(slots: fhir4.Slot[], weekStartISO: string): SlotCalendarRow[] {
  const dates = weekDates(weekStartISO);
  const byKey = new Map<string, fhir4.Slot[]>();
  const times = new Set<string>();

  for (const slot of slots) {
    const time = slotTime(slot);
    times.add(time);
    const key = `${slotDate(slot)}T${time}`;
    const cell = byKey.get(key);
    if (cell) cell.push(slot);
    else byKey.set(key, [slot]);
  }

  return [...times].sort().map((time) => ({
    time,
    cells: dates.map((date) => ({ date, slots: byKey.get(`${date}T${time}`) ?? [] })),
  }));
}

export interface SlotCellSummary {
  /** その日時の枠の総数 = 定員。 */
  total: number;
  free: number;
  booked: number;
  unavailable: number;
  /** 停止・削除の対象にできる枠(予約が入っていないもの)。 */
  operable: fhir4.Slot[];
}

export function summarizeSlotCell(slots: fhir4.Slot[]): SlotCellSummary {
  return {
    total: slots.length,
    free: slots.filter((s) => s.status === "free").length,
    booked: slots.filter(isBookedSlot).length,
    unavailable: slots.filter((s) => s.status === "busy-unavailable").length,
    operable: slots.filter((s) => !isBookedSlot(s) && s.id),
  };
}

/**
 * セルに出す文言。定員 1 の枠表は状態をそのまま出し(「空き」「予約済」)、
 * 定員が複数のときは「空き 2/3」と残数を出す。
 *
 * 空きが無いときも「満」ではなく「空き 0/3」と書くのは、内訳が予約とは限らない
 * ため(予約 1 + 停止 2 でも空きは 0)。内訳はセルの title に出す。
 */
export function slotCellLabel(summary: SlotCellSummary, slots: fhir4.Slot[]): string {
  if (summary.total === 0) return "";
  if (summary.total === 1) return slotStatusLabel(slots[0].status);
  if (summary.free === 0 && summary.unavailable === summary.total) return "停止";
  return `空き ${summary.free}/${summary.total}`;
}

/** セルの色。空きが残っていれば空き扱い、無ければ予約済(全部停止なら停止)。 */
export function slotCellStatus(summary: SlotCellSummary, slots: fhir4.Slot[]): string {
  if (summary.total === 1) return slots[0].status;
  if (summary.free > 0) return "free";
  if (summary.unavailable === summary.total) return "busy-unavailable";
  return "busy";
}
