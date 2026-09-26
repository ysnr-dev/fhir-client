// 補足用法コード(JAMI 処方・注射オーダ標準用法規格の 8 桁コード)。
//
// 16 桁の用法コードでは表せない、日をまたぐ投与スケジュール(I 日数間隔 / W 曜日 /
// D 日付 / C 期間内回数)と、服用タイミングごとに量が変わる不均等投与(V)を表す。
// I/W/D/C は RP 単位、V は薬剤単位で持つ。
//
// FHIR では Dosage.additionalInstruction に 1 コード 1 要素で入れる。用法コメントは
// coding を持たない要素なので、system で見分ける。

import { isAsNeededUsage, isOralUsage } from "./medicationScheduleHelpers";

export const SUPPLEMENTARY_USAGE_SYSTEM = "urn:oid:1.2.392.200250.2.2.20.22";

export type SupplementPeriod = "Y" | "M" | "W";

export type SupplementaryUsage =
  | { kind: "interval"; onDays: number; offDays: number }
  | { kind: "weekday"; days: boolean[] }
  | { kind: "date"; months: SupplementDateMonth[] }
  | { kind: "count"; period: SupplementPeriod; times: number };

export type SupplementKind = SupplementaryUsage["kind"];

/** 日付指定の 1 行。month は 1〜12、0 は毎月。 */
export interface SupplementDateMonth {
  month: number;
  days: number[];
}

export const SUPPLEMENT_KIND_OPTIONS: { kind: SupplementKind; label: string }[] = [
  { kind: "interval", label: "日数間隔" },
  { kind: "weekday", label: "曜日" },
  { kind: "date", label: "日付" },
  { kind: "count", label: "期間内回数" },
];

export const SUPPLEMENT_PERIOD_OPTIONS: { code: SupplementPeriod; label: string }[] = [
  { code: "W", label: "週" },
  { code: "M", label: "月" },
  { code: "Y", label: "年" },
];

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export const MAX_INTERVAL_DAYS = 31;
export const MAX_COUNT_TIMES = 35;
/** 不均等で指定できる 1 日の服用回数の上限(2 桁目は 1〜5)。 */
const MAX_UNEVEN_TIMINGS = 5;
/** 不均等の服用量に使える桁数(3〜8 桁目)。小数点も 1 桁に数える。 */
const UNEVEN_DOSE_WIDTH = 6;

export function emptySupplement(kind: SupplementKind): SupplementaryUsage {
  switch (kind) {
    case "interval":
      return { kind, onDays: 1, offDays: 1 };
    case "weekday":
      return { kind, days: WEEKDAY_LABELS.map(() => false) };
    case "date":
      return { kind, months: [{ month: 0, days: [] }] };
    case "count":
      return { kind, period: "W", times: 1 };
  }
}

// ---- 1 桁の数値 ----

/** 1〜9 は数字、10 以降は A から。 */
function digitOf(value: number): string {
  return value < 10 ? String(value) : String.fromCharCode("A".charCodeAt(0) + value - 10);
}

function valueOfDigit(char: string): number | null {
  if (/^[1-9]$/.test(char)) return Number(char);
  if (/^[A-Z]$/.test(char)) return char.charCodeAt(0) - "A".charCodeAt(0) + 10;
  return null;
}

// ---- コード生成 ----

function pad(code: string, filler: string): string {
  return code.padEnd(8, filler);
}

/**
 * 日付指定の行を並べる。毎月を先に、個別の月は投与開始日の月から近い順
 * (12 月開始なら 12 月 → 1 月)。
 */
function orderedMonths(months: SupplementDateMonth[], startMonth: number): SupplementDateMonth[] {
  const distance = (month: number) => (month === 0 ? -1 : (month - startMonth + 12) % 12);
  return months
    .filter((m) => m.days.length > 0)
    .map((m) => ({ month: m.month, days: [...new Set(m.days)].sort((a, b) => a - b) }))
    .sort((a, b) => distance(a.month) - distance(b.month));
}

/** 補足用法コード。日付指定は 1 コード 6 日までなので複数になることがある。 */
export function supplementCodes(supplement: SupplementaryUsage, startMonth = 1): string[] {
  switch (supplement.kind) {
    case "interval":
      return [pad(`I${digitOf(supplement.onDays)}${digitOf(supplement.offDays)}`, "0")];
    case "weekday":
      return [`W${supplement.days.map((d) => (d ? "1" : "0")).join("")}`];
    case "date":
      return orderedMonths(supplement.months, startMonth).flatMap(({ month, days }) => {
        const codes: string[] = [];
        for (let i = 0; i < days.length; i += 6) {
          codes.push(pad(`D${digitOf(month)}${days.slice(i, i + 6).map(digitOf).join("")}`, "0"));
        }
        return codes;
      });
    case "count":
      return [pad(`C${supplement.period}${digitOf(supplement.times)}`, "0")];
  }
}

/** 不均等のコード。量は入力どおりの文字列(`3.5`)を使う。 */
export function unevenCodes(doses: string[]): string[] {
  return doses.map((dose, i) => pad(`V${i + 1}${dose.trim()}`, "N"));
}

/** 不均等の量として書けるか(数字と小数点で 6 桁以内)。 */
export function isValidUnevenDose(dose: string): boolean {
  const value = dose.trim();
  return /^\d+(\.\d+)?$/.test(value) && value.length <= UNEVEN_DOSE_WIDTH;
}

/** 不均等の 1 日量(各タイミングの合計)。 */
export function unevenDailyDose(doses: string[]): string {
  const total = doses.reduce((sum, dose) => sum + (Number(dose) || 0), 0);
  return String(Number(total.toFixed(4)));
}

// ---- コード解析 ----

function monthLabel(month: number): string {
  return month === 0 ? "毎月" : `${month}月`;
}

function daysLabel(days: number[]): string {
  return days.map((d) => `${d}日`).join("・");
}

/** 1 コードぶんの表示(FHIR の display に入れる)。 */
function codeDisplay(code: string): string {
  switch (code[0]) {
    case "I":
      return `${valueOfDigit(code[1])}日服用・${valueOfDigit(code[2])}日休薬`;
    case "W":
      return weekdayLabel(code.slice(1).split("").map((c) => c === "1"));
    case "D": {
      const days = code.slice(2).split("").map(valueOfDigit).filter((d): d is number => d !== null);
      return `${monthLabel(valueOfDigit(code[1]) ?? 0)}${daysLabel(days)}`;
    }
    case "C":
      return `${periodLabel(code[1] as SupplementPeriod)}${valueOfDigit(code[2])}回`;
    default:
      return code;
  }
}

function weekdayLabel(days: boolean[]): string {
  return `毎週${WEEKDAY_LABELS.filter((_, i) => days[i]).join("・")}曜日`;
}

function periodLabel(period: SupplementPeriod): string {
  return SUPPLEMENT_PERIOD_OPTIONS.find((p) => p.code === period)?.label ?? "";
}

/** 補足用法コード(I/W/D/C)から入力値に戻す。読めなければ null。 */
export function parseSupplementCodes(codes: string[]): SupplementaryUsage | null {
  const head = codes[0];
  if (!head) return null;
  switch (head[0]) {
    case "I": {
      const onDays = valueOfDigit(head[1]);
      const offDays = valueOfDigit(head[2]);
      return onDays && offDays ? { kind: "interval", onDays, offDays } : null;
    }
    case "W":
      return { kind: "weekday", days: head.slice(1, 8).split("").map((c) => c === "1") };
    case "D": {
      const months: SupplementDateMonth[] = [];
      for (const code of codes.filter((c) => c[0] === "D")) {
        const month = code[1] === "0" ? 0 : (valueOfDigit(code[1]) ?? 0);
        const days = code.slice(2).split("").map(valueOfDigit).filter((d): d is number => d !== null);
        // 7 日以上の月は同じ月のコードが続くので 1 行にまとめる。
        const row = months.find((m) => m.month === month);
        if (row) row.days.push(...days);
        else months.push({ month, days });
      }
      return { kind: "date", months };
    }
    case "C": {
      const times = valueOfDigit(head[2]);
      const period = head[1] as SupplementPeriod;
      return times && ["Y", "M", "W"].includes(period) ? { kind: "count", period, times } : null;
    }
    default:
      return null;
  }
}

/** 不均等のコードから量の並びに戻す(服用順に並べる)。 */
export function parseUnevenCodes(codes: string[]): string[] | null {
  const doses = codes
    .filter((c) => c[0] === "V")
    .map((c) => ({ order: Number(c[1]), dose: c.slice(2).replace(/N+$/, "") }))
    .sort((a, b) => a.order - b.order)
    .map((c) => c.dose);
  return doses.length ? doses : null;
}

/** 補足用法の表示(「毎月10日・20日」「週2回」)。 */
export function supplementLabel(supplement: SupplementaryUsage | null | undefined): string {
  if (!supplement) return "";
  switch (supplement.kind) {
    case "interval":
      return `${supplement.onDays}日服用・${supplement.offDays}日休薬`;
    case "weekday":
      return weekdayLabel(supplement.days);
    case "date":
      return orderedMonths(supplement.months, 1)
        .map(({ month, days }) => `${monthLabel(month)}${daysLabel(days)}`)
        .join("、");
    case "count":
      return `${periodLabel(supplement.period)}${supplement.times}回`;
  }
}

/** 補足用法が入力しきれていなければ、その理由。 */
export function supplementError(supplement: SupplementaryUsage): string | null {
  switch (supplement.kind) {
    case "interval":
      if (!inRange(supplement.onDays, MAX_INTERVAL_DAYS) || !inRange(supplement.offDays, MAX_INTERVAL_DAYS)) {
        return `補足用法の服用日数・休薬日数は1〜${MAX_INTERVAL_DAYS}で入力してください。`;
      }
      return null;
    case "weekday":
      return supplement.days.some(Boolean) ? null : "補足用法の曜日を選択してください。";
    case "date":
      return supplement.months.some((m) => m.days.length > 0)
        ? null
        : "補足用法の日付を選択してください。";
    case "count":
      return inRange(supplement.times, MAX_COUNT_TIMES)
        ? null
        : `補足用法の回数は1〜${MAX_COUNT_TIMES}で入力してください。`;
  }
}

function inRange(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

// ---- 不均等のタイミング ----

/** 食事ベース型のスロット(5〜9 桁目)。並びは 1 日の中の順。 */
const MEAL_SLOTS = [
  { offset: 8, label: "起床時", hour: 6 },
  { offset: 7, label: "朝", hour: 8 },
  { offset: 6, label: "昼", hour: 12 },
  { offset: 5, label: "夕", hour: 18 },
  { offset: 4, label: "就寝前", hour: 21 },
];

function hourOfLetter(letter: string): number | null {
  return /^[A-X]$/.test(letter) ? letter.charCodeAt(0) - "A".charCodeAt(0) : null;
}

/**
 * 不均等で量を入れるタイミングの名前(1 日の中の順)。用法が不均等にできないものなら null。
 *
 * 回数は用法コードの 4 桁目。頓用・内服以外・回数が 2〜5 でない用法は不均等にできない。
 * 名前は用法コードから読めるものだけ付け、読めなければ「1回目」「2回目」とする。
 */
export function unevenTimingLabels(usageCode: string | null | undefined): string[] | null {
  if (!usageCode || !isOralUsage(usageCode) || isAsNeededUsage(usageCode)) return null;
  const count = Number(usageCode[3]);
  if (!Number.isInteger(count) || count < 2 || count > MAX_UNEVEN_TIMINGS) return null;

  let named: { label: string; hour: number }[] = [];
  if (usageCode[2] === "1") {
    named = MEAL_SLOTS.filter((slot) => usageCode[slot.offset] && usageCode[slot.offset] !== "0");
    for (const letter of usageCode.slice(9)) {
      const hour = hourOfLetter(letter);
      if (hour !== null) named.push({ label: `${hour}時`, hour });
    }
  } else if (usageCode[2] === "3") {
    for (const letter of usageCode.slice(4, 9)) {
      const hour = hourOfLetter(letter);
      if (hour !== null) named.push({ label: `${hour}時`, hour });
    }
  }
  if (named.length === count) {
    return [...named].sort((a, b) => a.hour - b.hour).map((n) => n.label);
  }
  return Array.from({ length: count }, (_, i) => `${i + 1}回目`);
}

/** 不均等の表示(「朝 3.5錠・夕 1錠」)。 */
export function unevenLabel(
  doses: string[] | null | undefined,
  usageCode: string | null | undefined,
  unit: string | null | undefined,
): string {
  if (!doses?.length) return "";
  const labels = unevenTimingLabels(usageCode);
  return doses
    .map((dose, i) => `${labels?.[i] ?? `${i + 1}回目`} ${Number(dose)}${unit ?? ""}`)
    .join("・");
}

// ---- FHIR ----

function instruction(code: string, display: string): fhir4.CodeableConcept {
  return {
    coding: [{ system: SUPPLEMENTARY_USAGE_SYSTEM, code, display }],
    text: display,
  };
}

/** RP の補足用法を additionalInstruction の要素にする。 */
export function supplementInstructions(
  supplement: SupplementaryUsage | null | undefined,
  startMonth: number,
): fhir4.CodeableConcept[] {
  if (!supplement) return [];
  return supplementCodes(supplement, startMonth).map((code) => instruction(code, codeDisplay(code)));
}

/** 薬剤の不均等を additionalInstruction の要素にする。 */
export function unevenInstructions(
  doses: string[] | null | undefined,
  usageCode: string | null | undefined,
  unit: string | null | undefined,
): fhir4.CodeableConcept[] {
  if (!doses?.length) return [];
  const labels = unevenTimingLabels(usageCode);
  return unevenCodes(doses).map((code, i) =>
    instruction(code, `${labels?.[i] ?? `${i + 1}回目`} ${Number(doses[i])}${unit ?? ""}`),
  );
}

function supplementaryCodesOf(dosage: fhir4.Dosage | undefined): string[] {
  return (dosage?.additionalInstruction ?? [])
    .flatMap((ai) => ai.coding ?? [])
    .filter((c) => c.system === SUPPLEMENTARY_USAGE_SYSTEM && c.code)
    .map((c) => c.code as string);
}

/** Dosage に入っている補足用法(I/W/D/C)。 */
export function supplementOf(dosage: fhir4.Dosage | undefined): SupplementaryUsage | null {
  return parseSupplementCodes(supplementaryCodesOf(dosage).filter((c) => c[0] !== "V"));
}

/** Dosage に入っている不均等の量。 */
export function unevenDosesOf(dosage: fhir4.Dosage | undefined): string[] | null {
  return parseUnevenCodes(supplementaryCodesOf(dosage));
}

/** 用法コメント。補足用法の要素(coding あり)を除いた最初の文。 */
export function usageCommentOf(dosage: fhir4.Dosage | undefined): string | undefined {
  return dosage?.additionalInstruction?.find((ai) => !ai.coding?.length)?.text;
}
