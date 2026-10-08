// DPC 様式1 の定義表。厚生労働省「DPC の評価・検証等に係る調査(退院患者調査)
// 実施説明資料」の様式1 のペイロード項目を書き起こしたもの。
//
// 項目は実施説明資料の版ごとに増減するので、定義表は版ごとに持つ。版の切り替わりは
// 診療報酬改定の施行日に合わせて資料が決める(2026 年度版は 2026 年 6 月 1 日から。
// 2026 年 4・5 月は 2025 年度版)。入院ごとに、退院日(未退院なら今日)に適用される版を使う。

import { CLINICAL_RECORDS } from "./records/clinical";
import { COMMON_RECORDS } from "./records/common";
import { DISEASE_RECORDS } from "./records/disease";
import { revise2026 } from "./records/revision2026";
import type { Dpc1RecordDef } from "./types";

export * from "./types";

/** 2025 年度版の実施説明資料(2025 年 5 月 30 日)の定義表。 */
const DEFINITIONS_2025: Dpc1RecordDef[] = [...COMMON_RECORDS, ...CLINICAL_RECORDS, ...DISEASE_RECORDS];

/** 2026 年度版の実施説明資料(2026 年 7 月 17 日)の定義表。 */
const DEFINITIONS_2026: Dpc1RecordDef[] = revise2026(DEFINITIONS_2025);

/** 定義表を持っている版(新しい順)。from はその版を使い始める日。最も古い版はそれより前にも使う。 */
const EDITIONS: { year: string; from: string; records: Dpc1RecordDef[] }[] = [
  { year: "2026", from: "2026-06-01", records: DEFINITIONS_2026 },
  { year: "2025", from: "2025-04-01", records: DEFINITIONS_2025 },
];

/** 日付(YYYY-MM-DD)に適用される版の年度。 */
export function dpc1EditionYear(date: string): string {
  return (EDITIONS.find((edition) => edition.from <= date) ?? EDITIONS[EDITIONS.length - 1]).year;
}

/** その版の定義表。定義表を持たない年度には、それ以前で最も新しい版を返す。 */
export function dpc1Definitions(year: string): Dpc1RecordDef[] {
  const found = EDITIONS.find((edition) => Number(edition.year) <= Number(year));
  return (found ?? EDITIONS[EDITIONS.length - 1]).records;
}
