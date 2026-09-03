import { addDays } from "../lib/dates";
import type { MealScheduleSettings } from "./mealOrderHelpers";
import {
  isValidTime,
  minutesOfTime,
  type NursingScheduleSettings,
} from "./nursingScheduleHelpers";

// 内服の与薬の予定時刻。**用法コードから出す**。
//
// 処方は「1 日 N 回・食後」までしか持たず、何時に飲ませるかはどこにも無い。
// 用法コード(電子処方箋用法マスタ、16 桁)の桁を読み、施設の食事時刻と突き合わせて
// その日の予定時刻を組み立てる。
//
// 桁の意味(開発 DB の内服 253 件で突合して確認):
//
//   1     基本区分。`1` = 内服
//   2     詳細区分(`0` 経口 `1` 舌下 `3` 口腔内塗布)。ここでは区別しない
//   3     タイミング区分。`1` 食事ベース `2` 等間隔 `3` 時刻指定 `4` イベント
//         `5` 頓用 `7` 回数のみ
//   4     1 日の回数(`1`〜`9`、`Z` = 不定)
//   5〜9  **食事ベース型**: 就寝 / 夕 / 昼 / 朝 / 起床 のスロット。`0` は無し、
//         就寝〜朝は `1` 食前 `2` 食直前 `3` 食直後 `4` 食後 `5` 食後 2 時間 `6` 食事中、
//         起床だけは `9`(起床に食前・食後は無い)。
//         **時刻指定型**: 1 文字が 1 回ぶんの時刻(`A` = 0 時 … `X` = 23 時)。
//         `Z` は「決まった時刻に」で具体的な時刻を持たない
//   10〜16 食事ベース型で食事以外の時刻も足すとき、その時刻(`101514440P` =
//         1 日 5 回 朝昼夕食後・15 時・就寝前)。それ以外は `0`
//
// 展開できない用法(頓用・イベント型・「決まった時刻に」・想定外の文字)は**予定を
// 出さない**。経過表にはその用法の実施の印だけが並ぶ。

/** 食前・食後のずらしと、就寝前・起床時の時刻。食事の時刻は `meal_schedule`。 */
export interface MedicationScheduleSettings {
  /** 食前・食直前のずらし(分)。食事の時刻から引く。 */
  before_meal_minutes: number;
  /** 食直後・食後のずらし(分)。食事の時刻に足す。 */
  after_meal_minutes: number;
  /** 就寝前の時刻。 */
  bedtime: string;
  /** 起床時の時刻。 */
  wake_time: string;
}

export const DEFAULT_MEDICATION_SCHEDULE: MedicationScheduleSettings = {
  before_meal_minutes: 30,
  after_meal_minutes: 30,
  bedtime: "21:00",
  wake_time: "06:00",
};

/** 内服の用法か(1 桁目)。注射・外用・注入は経過表の内服欄に出さない。 */
export function isOralUsage(usageCode: string | undefined): boolean {
  return usageCode?.[0] === "1";
}

/**
 * 頓用の用法か(3 桁目)。
 *
 * `basic_usage_category` は 内服 / 外用 / 注射 / 注入 の 4 種だけで「頓服」は無いので、
 * `prescriptionHelpers` の `BASIC_USAGE_CATEGORY_AS_NEEDED` では判定できない。
 */
export function isAsNeededUsage(usageCode: string | undefined): boolean {
  return usageCode?.[2] === "5";
}

/** 5〜9 桁目のスロットの位置。 */
const SLOT_OFFSET = { bedtime: 4, dinner: 5, lunch: 6, breakfast: 7, wake: 8 } as const;

/** 時刻指定型の文字 → 時。`A` = 0 時 … `X` = 23 時。 */
function hourOfLetter(letter: string): number | null {
  if (!/^[A-X]$/.test(letter)) return null;
  return letter.charCodeAt(0) - "A".charCodeAt(0);
}

function timeOfMinutes(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** 食事の時刻とスロットの修飾から与薬時刻を出す。修飾が `0`(無し)なら null。 */
function mealSlotTime(
  modifier: string,
  mealTime: string,
  settings: MedicationScheduleSettings,
): string | null {
  if (!isValidTime(mealTime)) return null;
  const base = minutesOfTime(mealTime);
  switch (modifier) {
    // 食前と食直前、食直後と食後は同じずらしに丸める(設定が 2 段階しかない)。
    case "1":
    case "2":
      return timeOfMinutes(base - settings.before_meal_minutes);
    case "3":
    case "4":
      return timeOfMinutes(base + settings.after_meal_minutes);
    case "5":
      return timeOfMinutes(base + 120);
    case "6":
      return mealTime;
    default:
      return null;
  }
}

/** 10 桁目以降に入っている時刻(食事ベース型で食事以外の時刻も指定する用法)。 */
function extraHourTimes(usageCode: string): string[] {
  return usageCode
    .slice(9)
    .split("")
    .map(hourOfLetter)
    .filter((hour): hour is number => hour !== null)
    .map((hour) => `${String(hour).padStart(2, "0")}:00`);
}

/**
 * 用法コードをその日の予定時刻(`HH:mm` の昇順)に展開する。
 *
 * 展開できない用法は空配列。日付を引数に取らないのは、内服の予定が曜日で変わらない
 * ため(看護指示の `expandNursingSchedule` は週 N 回があるので日付を要る)。
 */
export function expandUsageSchedule(
  usageCode: string | undefined,
  meal: MealScheduleSettings,
  settings: MedicationScheduleSettings,
  nursing: NursingScheduleSettings,
): string[] {
  if (!usageCode || !isOralUsage(usageCode)) return [];
  const timingCategory = usageCode[2];
  const count = usageCode[3];
  const times: string[] = [];

  if (timingCategory === "1") {
    // 食事ベース型。スロットごとに食事の時刻をずらす。
    if (usageCode[SLOT_OFFSET.wake] !== "0") times.push(settings.wake_time);
    if (usageCode[SLOT_OFFSET.bedtime] !== "0") times.push(settings.bedtime);
    for (const [key, offset] of [
      ["breakfast", SLOT_OFFSET.breakfast],
      ["lunch", SLOT_OFFSET.lunch],
      ["dinner", SLOT_OFFSET.dinner],
    ] as const) {
      const time = mealSlotTime(usageCode[offset], meal[key], settings);
      if (time) times.push(time);
    }
    times.push(...extraHourTimes(usageCode));
  } else if (timingCategory === "3") {
    // 時刻指定型。5 桁目から回数ぶんの文字を時刻に読む。`Z`(決まった時刻に)は展開しない。
    const letters = usageCode.slice(4, 9).split("").filter((c) => c !== "0");
    if (letters.some((c) => hourOfLetter(c) === null)) return [];
    for (const letter of letters) {
      times.push(`${String(hourOfLetter(letter)).padStart(2, "0")}:00`);
    }
  } else if (timingCategory === "2") {
    // 等間隔型。回数から間隔を出し、看護指示と同じ起点から刻む。
    const perDay = Number(count);
    if (!Number.isFinite(perDay) || perDay <= 0) return [];
    const start = isValidTime(nursing.interval_start)
      ? minutesOfTime(nursing.interval_start)
      : 0;
    const step = Math.round((24 / perDay) * 60);
    for (let i = 0; i < perDay; i += 1) times.push(timeOfMinutes(start + step * i));
  } else if (timingCategory === "7") {
    // 回数のみ指定型。時刻の手がかりが無いので看護指示の「1日N回」の既定時刻を借りる。
    times.push(...(nursing.daily[count] ?? []));
  }
  // イベント型(空腹時・哺乳時)と頓用は展開しない。

  return [...new Set(times.filter(isValidTime))].sort(
    (a, b) => minutesOfTime(a) - minutesOfTime(b),
  );
}

/** RP の投与終了日(投与開始日 + 投与日数 − 1)。日数を持たない RP は undefined。 */
export function rpEndDate(
  startDate: string,
  rp: { doseDays?: number; usageCode?: string },
): string | undefined {
  if (!startDate || isAsNeededUsage(rp.usageCode)) return undefined;
  if (!rp.doseDays || rp.doseDays < 1) return undefined;
  return addDays(startDate, rp.doseDays - 1);
}

/** RP が有効な日。投与日数を持たない RP は投与開始日の 1 日だけ。 */
export function rpActiveDays(
  startDate: string,
  rp: { doseDays?: number; usageCode?: string },
): string[] {
  if (!startDate) return [];
  const end = rpEndDate(startDate, rp) ?? startDate;
  const days: string[] = [];
  for (let day = startDate; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}
