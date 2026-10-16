import type { MedicineAttributeQuantity } from "../api/masterClient";

// 抗菌薬の使用量の集計(AUD・DOT)。設計は docs/antimicrobial-stewardship-design.md §3。
//
//   DOT = 投与日数(患者 × 成分 × 日の重複を除いた数)÷ 在院患者延日数 × 1000
//   AUD = 投与量の合計 ÷ DDD ÷ 在院患者延日数 × 1000
//
// 在院患者延日数は、対象の病棟(全体なら全病棟)に日ごとに居た患者数を月の範囲で足したもの(入院日・退院日を含む)。
// 投与はその日・その患者が対象の病棟に居たときだけ数える(病棟ごとの集計で、転棟前後の投与を振り分けるため)。

/** 実施した抗菌薬の投与 1 件(注射の実施記録 MedicationAdministration)。 */
export interface AntimicrobialAdministration {
  patientId: string;
  day: string;
  medicineCode: string;
  ingredient: string;
  name: string;
  dose: number | null;
  unit: string | null;
}

export interface AntimicrobialUsageRow {
  ingredient: string;
  name: string;
  patients: number;
  /** 投与日数(患者 × 日)。 */
  days: number;
  dot: number | null;
  /** DDD に換算した投与量の合計(DDD の数)。換算できない投与があれば、換算できた分だけ。 */
  ddds: number | null;
  aud: number | null;
  /** DDD 未設定・単位を換算できない投与の件数。 */
  unconverted: number;
}

export interface AntimicrobialUsageSummary {
  patientDays: number;
  rows: AntimicrobialUsageRow[];
  total: { patients: number; days: number; dot: number | null; aud: number | null; unconverted: number };
}

/** 投与量を DDD の単位に直す(換算できなければ null)。fhir/doseConversionHelpers.ts の convertDose を渡す。 */
export type DoseConverter = (dose: number, unit: string | null, medicineCode: string, targetUnit: string) => number | null;

/** DDD の単位 MU(百万単位)を、医薬品マスタの力価の単位「万単位」で換算するための写し。 */
const DDD_UNIT_FOR_CONVERSION: Record<string, { unit: string; factor: number }> = {
  g: { unit: "g", factor: 1 },
  mg: { unit: "mg", factor: 1 },
  MU: { unit: "万単位", factor: 100 },
};

function per1000(value: number, patientDays: number): number | null {
  return patientDays > 0 ? Math.round((value / patientDays) * 1000 * 100) / 100 : null;
}

export function summarizeAntimicrobialUsage(args: {
  administrations: AntimicrobialAdministration[];
  /** 日 → 対象の病棟に居た患者。 */
  presence: Map<string, Set<string>>;
  ddd: ReadonlyMap<string, MedicineAttributeQuantity | null>;
  convert: DoseConverter;
}): AntimicrobialUsageSummary {
  const { presence, ddd, convert } = args;
  let patientDays = 0;
  for (const patients of presence.values()) patientDays += patients.size;

  const groups = new Map<
    string,
    { name: string; patients: Set<string>; days: Set<string>; ddds: number; converted: number; unconverted: number }
  >();
  const allPatients = new Set<string>();
  const allDays = new Set<string>();
  let allDdds = 0;
  let allUnconverted = 0;

  for (const administration of args.administrations) {
    if (!presence.get(administration.day)?.has(administration.patientId)) continue;
    const group = groups.get(administration.ingredient) ?? {
      name: administration.name,
      patients: new Set<string>(),
      days: new Set<string>(),
      ddds: 0,
      converted: 0,
      unconverted: 0,
    };
    group.patients.add(administration.patientId);
    group.days.add(`${administration.patientId}|${administration.day}`);
    allPatients.add(administration.patientId);
    allDays.add(`${administration.patientId}|${administration.ingredient}|${administration.day}`);

    const standard = ddd.get(administration.medicineCode);
    const target = standard ? DDD_UNIT_FOR_CONVERSION[standard.unit] : undefined;
    const amount =
      standard && target && administration.dose != null
        ? convert(administration.dose, administration.unit, administration.medicineCode, target.unit)
        : null;
    if (standard && target && amount != null && standard.value > 0) {
      const value = amount / target.factor / standard.value;
      group.ddds += value;
      group.converted += 1;
      allDdds += value;
    } else {
      group.unconverted += 1;
      allUnconverted += 1;
    }
    groups.set(administration.ingredient, group);
  }

  const rows: AntimicrobialUsageRow[] = [...groups.entries()]
    .map(([ingredient, group]) => ({
      ingredient,
      name: group.name,
      patients: group.patients.size,
      days: group.days.size,
      dot: per1000(group.days.size, patientDays),
      ddds: group.converted > 0 ? Math.round(group.ddds * 100) / 100 : null,
      aud: group.converted > 0 ? per1000(group.ddds, patientDays) : null,
      unconverted: group.unconverted,
    }))
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));

  return {
    patientDays,
    rows,
    total: {
      patients: allPatients.size,
      days: allDays.size,
      dot: per1000(allDays.size, patientDays),
      aud: allDdds > 0 ? per1000(allDdds, patientDays) : null,
      unconverted: allUnconverted,
    },
  };
}
