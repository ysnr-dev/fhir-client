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
