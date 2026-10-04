import { clockTime } from "../lib/dates";
import { INSULIN_UCUM, INSULIN_UNIT } from "./insulinScaleHelpers";

// 経過表のインスリン欄。注射欄は施用の有無を印で出すだけなので、インスリンは施行した単位を
// 時刻の枠に並べる(血糖値は測定の行に「血糖」として並ぶ)。量が UCUM の国際単位([iU])で
// 記録された MedicationAdministration をインスリンとみなす(インスリンの実施入力だけがこの形で書く。
// 輸血製剤の「2単位」などは表示名が同じ「単位」でもコードを持たない)。

export interface InsulinFlowsheetCell {
  /** 施用の開始日時(FHIR の dateTime)。枠の決定とホバーに使う。 */
  at: string;
  units: number;
}

export interface InsulinFlowsheetRow {
  /** 薬剤名。行のキーと見出し。 */
  name: string;
  cells: InsulinFlowsheetCell[];
}

function isInsulinAdministration(administration: fhir4.MedicationAdministration): boolean {
  if (administration.status !== "completed" && administration.status !== "stopped") return false;
  const dose = administration.dosage?.dose;
  return dose?.code === INSULIN_UCUM && dose.value != null;
}

/** 施行したインスリンを薬剤ごとの行にする。施用の無い薬剤は行を作らない。 */
export function buildInsulinRows(administrations: fhir4.MedicationAdministration[]): InsulinFlowsheetRow[] {
  const rows = new Map<string, InsulinFlowsheetRow>();
  for (const administration of administrations) {
    if (!isInsulinAdministration(administration)) continue;
    const at = administration.effectivePeriod?.start ?? administration.effectiveDateTime ?? "";
    if (!at) continue;
    const concept = administration.medicationCodeableConcept;
    const name = concept?.text ?? concept?.coding?.[0]?.display ?? "";
    const row = rows.get(name) ?? { name, cells: [] };
    row.cells.push({ at, units: administration.dosage?.dose?.value ?? 0 });
    rows.set(name, row);
  }
  const result = Array.from(rows.values());
  for (const row of result) row.cells.sort((a, b) => a.at.localeCompare(b.at));
  return result.sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/** 「08:05 4単位」。 */
export function insulinCellLabel(cell: InsulinFlowsheetCell): string {
  return `${clockTime(cell.at)} ${cell.units}${INSULIN_UNIT}`.trim();
}
