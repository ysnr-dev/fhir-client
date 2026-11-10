import { addDays } from "../lib/dates";
import { dayOfWeekCode } from "./injectionHelpers";

// 透析室のシフト(施設設定 `dialysis_shifts`。backend の FacilitySettings::DEFAULT_DIALYSIS_SHIFTS と
// 同じ形)。曜日 × シフトのオーダーの選択肢に使う。
//
// コードは一度付けたら変えない(オーダーのパターンが指している)。画面に出す名前はオーダーの
// 登録時に焼き付けるので、名前を変えても登録済みのオーダーの表示は動かない。

export interface DialysisShift {
  code: string;
  label: string;
  /** 開始時刻 HH:MM。 */
  start: string;
  /** 終了時刻 HH:MM。 */
  end: string;
}

export interface DialysisShiftSettings {
  shifts: DialysisShift[];
}

export const DEFAULT_DIALYSIS_SHIFTS: DialysisShiftSettings = {
  shifts: [
    { code: "am", label: "午前", start: "09:00", end: "13:30" },
    { code: "pm", label: "午後", start: "14:00", end: "18:30" },
  ],
};

/** 開始時刻の早い順。 */
export function sortedDialysisShifts(shifts: readonly DialysisShift[]): DialysisShift[] {
  return [...shifts].sort((a, b) => a.start.localeCompare(b.start));
}

/** 新しいシフトのコード。消したシフトのコードを使い回さない(古いオーダーが別のシフトを指さないように)。 */
export function newDialysisShiftCode(): string {
  return `s-${crypto.randomUUID().slice(0, 8)}`;
}

/** シフトの並びの検証。空文字なら妥当。backend の check と同じ決まりごと。 */
export function dialysisShiftsError(shifts: readonly DialysisShift[]): string {
  if (shifts.length === 0) return "シフトを 1 つ以上登録してください。";
  if (shifts.some((shift) => !shift.label.trim())) return "シフトの名前を入れてください。";
  if (shifts.some((shift) => !shift.start || !shift.end)) return "シフトの開始と終了を入れてください。";
  const reversed = shifts.find((shift) => shift.start >= shift.end);
  if (reversed) return `シフト「${reversed.label}」の終了は開始より後にしてください。`;
  const sorted = sortedDialysisShifts(shifts);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      return `シフト「${sorted[i - 1].label}」と「${sorted[i].label}」の時間帯が重なっています。`;
    }
  }
  return "";
}

// ---- 曜日 × シフト → 日付の展開 ----
//
// オーダーのパターン(曜日 × シフト)は予約を展開するときの材料で、予約の正本は Appointment
// (docs/dialysis-order-design.md §2.4)。展開はこの関数で日付を起こし、枠の有無の判定は
// dialysisAppointmentHelpers の planDialysisExpansion で行う。

/** 1 回の展開で作る予約の上限。超える指定は打ち切らずに止める(注射の連日展開と同じ)。 */
export const MAX_DIALYSIS_EXPAND = 40;

/** 展開の週数の上限。 */
export const MAX_DIALYSIS_EXPAND_WEEKS = 12;

/** パターンの 1 要素(オーダーの dialysis-schedule-pattern)。 */
export interface DialysisPatternSlot {
  dayOfWeek: string;
  shift: string;
  shiftLabel: string;
}

export interface DialysisOccurrence extends DialysisPatternSlot {
  date: string;
}

/**
 * from〜to(両端を含む)の、パターンに当たる日 × シフト。日付・シフトの開始の順。
 * 同じ日に 2 シフトあれば 2 件になる。上限は見ない(呼び出し側が件数で止める)。
 */
export function dialysisPatternOccurrences(
  pattern: readonly DialysisPatternSlot[],
  from: string,
  to: string,
  shifts: readonly DialysisShift[],
): DialysisOccurrence[] {
  if (!from || !to || to < from || pattern.length === 0) return [];
  const order = new Map(sortedDialysisShifts(shifts).map((shift, index) => [shift.code, index]));
  const occurrences: DialysisOccurrence[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = dayOfWeekCode(date);
    const entries = pattern
      .filter((entry) => entry.dayOfWeek === day)
      .sort((a, b) => (order.get(a.shift) ?? 99) - (order.get(b.shift) ?? 99));
    for (const entry of entries) occurrences.push({ ...entry, date });
  }
  return occurrences;
}

/** シフトの開始時刻。設定から消えたシフトは空。 */
export function dialysisShiftStart(shifts: readonly DialysisShift[], code: string): string {
  return shifts.find((shift) => shift.code === code)?.start ?? "";
}

/**
 * 時刻 HH:MM が入るシフト。枠はシフトの開始時刻に作るので開始の一致を先に見て、
 * 無ければ時間帯に入るものを返す。
 */
export function dialysisShiftAt(shifts: readonly DialysisShift[], time: string): DialysisShift | undefined {
  return (
    shifts.find((shift) => shift.start === time) ??
    shifts.find((shift) => shift.start <= time && time < shift.end)
  );
}
