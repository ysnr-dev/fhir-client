// DPC 様式1 の定義表。厚生労働省「DPC の評価・検証等に係る調査(退院患者調査)
// 実施説明資料」の様式1 のペイロード項目を書き起こしたもの。
//
// 項目は診療報酬改定の年度で増減するので、定義表は年度ごとに持つ。入院ごとに、
// 退院日(未退院なら今日)の属する年度の定義表を使う。

import { CLINICAL_RECORDS } from "./records/clinical";
import { COMMON_RECORDS } from "./records/common";
import { DISEASE_RECORDS } from "./records/disease";
import type { Dpc1RecordDef } from "./types";

export * from "./types";

/** 2025 年度版の実施説明資料(2025 年 5 月 30 日)の定義表。 */
const DEFINITIONS_2025: Dpc1RecordDef[] = [...COMMON_RECORDS, ...CLINICAL_RECORDS, ...DISEASE_RECORDS];

/** 定義表を持っている年度(新しい順)。これより新しい年度には最新の定義表を使う。 */
const DEFINITIONS_BY_YEAR: { fiscalYear: number; records: Dpc1RecordDef[] }[] = [
  { fiscalYear: 2025, records: DEFINITIONS_2025 },
];

/** 日付(YYYY-MM-DD)の属する年度(4 月始まり)。 */
export function dpc1FiscalYear(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return String(month >= 4 ? year : year - 1);
}

/** その年度の定義表。定義表を持たない年度には、それ以前で最も新しいものを返す。 */
export function dpc1Definitions(fiscalYear: string): Dpc1RecordDef[] {
  const year = Number(fiscalYear);
  const found = DEFINITIONS_BY_YEAR.find((d) => d.fiscalYear <= year);
  return (found ?? DEFINITIONS_BY_YEAR[DEFINITIONS_BY_YEAR.length - 1]).records;
}
