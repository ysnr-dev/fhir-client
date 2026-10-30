import { weekdayOf } from "./dates";

// 祝日・休診日(マスタの YYYY-MM-DD → 名称)を日付の扱いに当てる純粋関数。
// マスタの読み込みは api/masterQueries の useHolidays。

export type HolidayNames = ReadonlyMap<string, { name: string }>;

/**
 * カレンダーの色分け用の曜日(0=日 … 6=土)。祝日・休診日は日曜と同じ 0 を返すので、
 * 曜日で色を付けている既存の分岐にそのまま渡せる。
 */
export function calendarWeekday(date: string, holidays: HolidayNames): number | null {
  if (holidays.has(date)) return 0;
  return weekdayOf(date);
}

/** 祝日・休診日の名称(カレンダーの title 用)。平日は undefined。 */
export function holidayName(date: string, holidays: HolidayNames): string | undefined {
  return holidays.get(date)?.name;
}
