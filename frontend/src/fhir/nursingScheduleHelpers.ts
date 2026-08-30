import type { NursingPerformDisplay } from "./nursingPerformHelpers";

// 看護指示の頻度(予定)。
//
// 「1日3回」「4時間毎」のような頻度を FHIR の Timing で持ち、その日の予定時刻に展開して
// 実施入力のタイミングを示す。Timing は ServiceRequest の root 拡張
// `nursing-order-schedule` の valueTiming に置く。occurrenceTiming にしないのは、
// occurrence[x] が choice で occurrenceDateTime(開始日)と併用できず、上流の索引も
// occurrenceDateTime だけだから(終了日の拡張と同じ判断)。
//
// 条件(「38℃以上で報告」)は頻度とは別物なので、従来どおり orderDetail[0].text の
// 自由記載に残す。Timing を持たない指示(適宜・必要時・拡張を付ける前の指示)は
// 予定を持たず、実施入力ではいつでも入れられる。
//
// repeat の形:
//   1日N回   frequency=N, period=1, periodUnit=d, timeOfDay=[...]  (時刻は指示に焼き付ける)
//   N時間毎  period=N, periodUnit=h, timeOfDay=[起点]
//   時刻指定 timeOfDay=[...] のみ
//   週N回    frequency=N, period=1, periodUnit=wk, dayOfWeek=[...], timeOfDay=[時刻](任意)

export const NURSING_SCHEDULE_EXT_URL =
  "http://fhir-client.local/StructureDefinition/nursing-order-schedule";

/** 施設の既定時刻(backend の facility_settings.nursing_schedule)。 */
export interface NursingScheduleSettings {
  /** 「1日N回」の N → 時刻(HH:mm)。 */
  daily: Record<string, string[]>;
  /** 「N時間毎」の起点(HH:mm)。 */
  interval_start: string;
}

/** 設定が読めていないときの既定。backend の DEFAULT_NURSING_SCHEDULE と同じ値。 */
export const DEFAULT_NURSING_SCHEDULE: NursingScheduleSettings = {
  daily: {
    "1": ["10:00"],
    "2": ["10:00", "18:00"],
    "3": ["09:00", "14:00", "20:00"],
    "4": ["06:00", "10:00", "14:00", "18:00"],
  },
  interval_start: "06:00",
};

export type NursingScheduleValues =
  | { kind: "daily"; timesPerDay: number; times: string[] }
  | { kind: "interval"; hours: number; start: string }
  | { kind: "times"; times: string[] }
  | { kind: "weekly"; perWeek: number; days: string[]; time: string }
  | null;

export const DAY_OF_WEEK_OPTIONS: { code: string; label: string }[] = [
  { code: "mon", label: "月" },
  { code: "tue", label: "火" },
  { code: "wed", label: "水" },
  { code: "thu", label: "木" },
  { code: "fri", label: "金" },
  { code: "sat", label: "土" },
  { code: "sun", label: "日" },
];

/** 頻度の選択肢。value はフォームの select の値。 */
export interface NursingSchedulePreset {
  value: string;
  label: string;
  make: (settings: NursingScheduleSettings) => NursingScheduleValues;
}

function dailyTimes(settings: NursingScheduleSettings, n: number): string[] {
  const times = settings.daily[String(n)];
  if (times && times.length === n) return [...times];
  // 設定に無い回数は 6 時から 1 日を等分した時刻を仮置きする(画面で直してもらう)。
  return Array.from({ length: n }, (_, i) => {
    const hour = (6 + Math.floor((24 / n) * i)) % 24;
    return `${String(hour).padStart(2, "0")}:00`;
  });
}

export const NURSING_SCHEDULE_PRESETS: NursingSchedulePreset[] = [
  { value: "", label: "適宜・必要時", make: () => null },
  { value: "daily-1", label: "1日1回", make: (s) => ({ kind: "daily", timesPerDay: 1, times: dailyTimes(s, 1) }) },
  { value: "daily-2", label: "1日2回", make: (s) => ({ kind: "daily", timesPerDay: 2, times: dailyTimes(s, 2) }) },
  { value: "daily-3", label: "1日3回", make: (s) => ({ kind: "daily", timesPerDay: 3, times: dailyTimes(s, 3) }) },
  { value: "daily-4", label: "1日4回", make: (s) => ({ kind: "daily", timesPerDay: 4, times: dailyTimes(s, 4) }) },
  { value: "interval-4", label: "4時間毎", make: (s) => ({ kind: "interval", hours: 4, start: s.interval_start }) },
  { value: "interval-6", label: "6時間毎", make: (s) => ({ kind: "interval", hours: 6, start: s.interval_start }) },
  { value: "interval-8", label: "8時間毎", make: (s) => ({ kind: "interval", hours: 8, start: s.interval_start }) },
  { value: "times", label: "時刻指定", make: () => ({ kind: "times", times: ["10:00"] }) },
  { value: "weekly", label: "週N回(曜日指定)", make: () => ({ kind: "weekly", perWeek: 1, days: [], time: "" }) },
];

/** フォームの値から select の値を逆引きする。当たらなければ「時刻指定」。 */
export function presetValueOf(schedule: NursingScheduleValues): string {
  if (!schedule) return "";
  if (schedule.kind === "daily") {
    const value = `daily-${schedule.timesPerDay}`;
    return NURSING_SCHEDULE_PRESETS.some((p) => p.value === value) ? value : "times";
  }
  if (schedule.kind === "interval") {
    const value = `interval-${schedule.hours}`;
    return NURSING_SCHEDULE_PRESETS.some((p) => p.value === value) ? value : "times";
  }
  return schedule.kind;
}

// ---- Timing との変換 ----

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(time: string): boolean {
  return TIME_PATTERN.test(time);
}

/** "HH:mm" → FHIR の time("HH:mm:ss")。 */
function toFhirTime(time: string): string {
  return `${time}:00`;
}

/** FHIR の time → "HH:mm"。 */
function fromFhirTime(time: string): string {
  return time.slice(0, 5);
}

export function scheduleValuesToTiming(values: NursingScheduleValues): fhir4.Timing | undefined {
  if (!values) return undefined;
  switch (values.kind) {
    case "daily":
      return {
        repeat: {
          frequency: values.timesPerDay,
          period: 1,
          periodUnit: "d",
          timeOfDay: values.times.map(toFhirTime),
        },
      };
    case "interval":
      return { repeat: { period: values.hours, periodUnit: "h", timeOfDay: [toFhirTime(values.start)] } };
    case "times":
      return { repeat: { timeOfDay: values.times.map(toFhirTime) } };
    case "weekly":
      return {
        repeat: {
          frequency: values.perWeek,
          period: 1,
          periodUnit: "wk",
          dayOfWeek: values.days as fhir4.TimingRepeat["dayOfWeek"],
          ...(values.time ? { timeOfDay: [toFhirTime(values.time)] } : {}),
        },
      };
  }
}

export function timingToScheduleValues(timing: fhir4.Timing | undefined): NursingScheduleValues {
  const repeat = timing?.repeat;
  if (!repeat) return null;
  const times = (repeat.timeOfDay ?? []).map(fromFhirTime);
  if (repeat.periodUnit === "h" && repeat.period) {
    return { kind: "interval", hours: repeat.period, start: times[0] ?? DEFAULT_NURSING_SCHEDULE.interval_start };
  }
  if (repeat.periodUnit === "wk") {
    return {
      kind: "weekly",
      perWeek: repeat.frequency ?? (repeat.dayOfWeek?.length || 1),
      days: [...(repeat.dayOfWeek ?? [])],
      time: times[0] ?? "",
    };
  }
  if (repeat.periodUnit === "d" && repeat.frequency) {
    return { kind: "daily", timesPerDay: repeat.frequency, times };
  }
  if (times.length > 0) return { kind: "times", times };
  return null;
}

/** 指示に付いた頻度(Timing)。無ければ undefined。 */
export function nursingScheduleOf(sr: fhir4.ServiceRequest): fhir4.Timing | undefined {
  return sr.extension?.find((e) => e.url === NURSING_SCHEDULE_EXT_URL)?.valueTiming;
}

export function nursingScheduleExtension(values: NursingScheduleValues): fhir4.Extension | undefined {
  const timing = scheduleValuesToTiming(values);
  return timing ? { url: NURSING_SCHEDULE_EXT_URL, valueTiming: timing } : undefined;
}

/** "09:00" → "9時"、複数は "9/14/20時"。 */
function hoursLabel(times: string[]): string {
  if (times.length === 0) return "";
  const parts = times.map((t) => {
    const [h, m] = t.split(":");
    return m === "00" ? String(Number(h)) : `${Number(h)}:${m}`;
  });
  return `${parts.join("/")}時`;
}

/** 頻度の表示。「1日3回 9/14/20時」「4時間毎(6時起点)」「週2回 月・木 10時」。 */
export function nursingScheduleLabel(timing: fhir4.Timing | undefined): string {
  const values = timingToScheduleValues(timing);
  if (!values) return "";
  switch (values.kind) {
    case "daily":
      return [`1日${values.timesPerDay}回`, hoursLabel(values.times)].filter(Boolean).join(" ");
    case "interval":
      return `${values.hours}時間毎(${hoursLabel([values.start])}起点)`;
    case "times":
      return hoursLabel(values.times);
    case "weekly": {
      const days = DAY_OF_WEEK_OPTIONS.filter((d) => values.days.includes(d.code))
        .map((d) => d.label)
        .join("・");
      return [`週${values.perWeek}回`, days, values.time ? hoursLabel([values.time]) : ""]
        .filter(Boolean)
        .join(" ");
    }
  }
}

// ---- その日の予定に展開 ----

/** "HH:mm" → 0 時からの分。 */
export function minutesOfTime(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * FHIR の dateTime(ローカル時刻 + オフセット。実施記録は toFhirDateTime で作る)の
 * 時刻部分を 0 時からの分にする。タイムゾーンは変換しない(atLabelOf と同じ考え方)。
 */
export function minutesOfDateTime(at: string): number | null {
  const time = at.slice(11, 16);
  return isValidTime(time) ? minutesOfTime(time) : null;
}

function timeOfMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const DAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * その日(YYYY-MM-DD)の予定時刻("HH:mm" 昇順)。
 * - N時間毎は起点から N 時間刻みで、その日の 0〜24 時に入るものだけ(起点より前も逆算する)。
 *   翌日にかかる分は翌日の展開で出る。24 で割り切れない間隔(5・7 時間)は日ごとに
 *   時刻がずれるが、起点固定・日単位展開の単純化として受け入れる。
 * - 週N回は dayOfWeek がその日に当たるときだけ。時刻が無ければ予定は持たない。
 * - 1日N回で timeOfDay が無い(異常データ)ときは施設の既定時刻で補う。
 */
export function expandNursingSchedule(
  timing: fhir4.Timing | undefined,
  date: string,
  settings: NursingScheduleSettings,
): string[] {
  const values = timingToScheduleValues(timing);
  if (!values) return [];
  let times: string[] = [];
  switch (values.kind) {
    case "daily":
      times = values.times.length > 0 ? values.times : (settings.daily[String(values.timesPerDay)] ?? []);
      break;
    case "times":
      times = values.times;
      break;
    case "interval": {
      if (values.hours <= 0) return [];
      const step = values.hours * 60;
      const start = minutesOfTime(values.start);
      // 起点から前後に伸ばして、その日に入る分だけ残す。
      const first = start - Math.floor(start / step) * step;
      for (let t = first; t < 1440; t += step) times.push(timeOfMinutes(t));
      break;
    }
    case "weekly": {
      const day = DAY_CODES[new Date(`${date}T00:00:00`).getDay()];
      if (!values.days.includes(day) || !values.time) return [];
      times = [values.time];
      break;
    }
  }
  return [...new Set(times.filter(isValidTime))].sort((a, b) => minutesOfTime(a) - minutesOfTime(b));
}

// ---- 予定と実施の突き合わせ ----

export interface NursingScheduleSlot {
  time: string;
  /** その予定に当てた実施記録。無ければ未実施。 */
  done: NursingPerformDisplay | null;
}

/** 予定と実施を結びつける許容幅(分)の上限。 */
const MAX_TOLERANCE_MINUTES = 60;

/**
 * 予定時刻ごとに実施記録を当てる。実施は最も近い予定に 1 対 1 で当て、許容幅は
 * min(60 分, 予定の最小間隔の半分)。固定 60 分だけだと近い予定(9:00/9:30)に同じ実施が
 * 二重に当たり、間隔の半分だけだと 1 日 1 回(±12 時間)で夕方の実施が朝の予定に当たる。
 * 許容幅に入らない実施は「予定外」として別に返す。
 */
export function matchPerformsToSchedule(
  times: string[],
  performs: NursingPerformDisplay[],
): { slots: NursingScheduleSlot[]; extra: NursingPerformDisplay[] } {
  const slots: NursingScheduleSlot[] = times.map((time) => ({ time, done: null }));
  if (slots.length === 0) return { slots, extra: [...performs] };

  let minGap = Infinity;
  for (let i = 1; i < times.length; i++) {
    minGap = Math.min(minGap, minutesOfTime(times[i]) - minutesOfTime(times[i - 1]));
  }
  const tolerance = Number.isFinite(minGap)
    ? Math.min(MAX_TOLERANCE_MINUTES, Math.floor(minGap / 2))
    : MAX_TOLERANCE_MINUTES;

  const extra: NursingPerformDisplay[] = [];
  // 古い順に当てる(同じ予定に複数あるときは先に来たものが予定どおり)。
  const ordered = [...performs].sort((a, b) => a.at.localeCompare(b.at));
  for (const perform of ordered) {
    const minutes = minutesOfDateTime(perform.at);
    if (minutes === null) {
      extra.push(perform);
      continue;
    }
    let best: NursingScheduleSlot | null = null;
    let bestDistance = Infinity;
    for (const slot of slots) {
      if (slot.done) continue;
      const distance = Math.abs(minutesOfTime(slot.time) - minutes);
      if (distance < bestDistance) {
        best = slot;
        bestDistance = distance;
      }
    }
    if (best && bestDistance <= tolerance) best.done = perform;
    else extra.push(perform);
  }
  return { slots, extra };
}

/**
 * 次に実施すべき予定。未実施のうち now 以前で最も遅いもの(= 遅れている)を優先し、
 * 無ければ now 以降で最も早いもの。すべて実施済みなら null。
 */
export function nextDueSlot(
  slots: NursingScheduleSlot[],
  nowMinutes: number,
): { slot: NursingScheduleSlot; late: boolean } | null {
  const pending = slots.filter((s) => !s.done);
  const late = pending.filter((s) => minutesOfTime(s.time) <= nowMinutes);
  if (late.length > 0) return { slot: late[late.length - 1], late: true };
  const upcoming = pending.find((s) => minutesOfTime(s.time) > nowMinutes);
  return upcoming ? { slot: upcoming, late: false } : null;
}

/** いま入れるべき予定があるか(遅れている、または now ±window 分に未実施の予定がある)。 */
export function isDueAround(
  slots: NursingScheduleSlot[],
  nowMinutes: number,
  windowMinutes = 60,
): boolean {
  const next = nextDueSlot(slots, nowMinutes);
  if (!next) return false;
  if (next.late) return true;
  return minutesOfTime(next.slot.time) - nowMinutes <= windowMinutes;
}
