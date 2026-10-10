import { encounterAdmissionRoute } from "./admissionRouteHelpers";
import { encounterBedSegments } from "./bedScheduleHelpers";
import { AMBULANCE_ARRIVAL_MODES, emergencyArrivalMode } from "./emergencyEncounterHelpers";
import type { AcuityEmergencyYearSetting } from "./nursingAcuityHelpers";
import { unitBedIndex, type AcuityUnit } from "./nursingAcuityUnitHelpers";

// 救急患者応需係数(docs/nursing-acuity-design.md §9)。令和8年度改定で、該当患者割合に病床あたりの
// 救急搬送受入件数に応じた係数を足した「割合指数」で基準を判定する(様式10 の記載要領)。
//
//   係数 = (1) 救急搬送受入件数 × ((4) 当該届出区分の救急搬送からの入院件数 ÷ (2) 係数を計算する全区分の
//          救急搬送からの入院件数) ÷ (3) 当該区分の病床数 × 0.005(上限 0.1)
//
// (1) は救急用の自動車・救急医療用ヘリで搬送された来院(外来のみで帰った分を含む病院全体)、期間は届出年度の
// 前年度(4 月〜翌 3 月)。月の指数にはその月の年度の前年度の係数を使う。

export const COEFFICIENT_PER_CASE = 0.005;
export const COEFFICIENT_CAP = 0.1;

/** 日付の年度(4 月始まり)。 */
export function fiscalYearOf(date: string): number {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? year : year - 1;
}

export function fiscalYearRange(fiscalYear: number): { from: string; to: string } {
  return { from: `${fiscalYear}-04-01`, to: `${fiscalYear + 1}-03-31` };
}

function inFiscalYear(date: string | undefined, fiscalYear: number): boolean {
  return Boolean(date) && fiscalYearOf(date as string) === fiscalYear;
}

/** (1) 年度の救急搬送受入件数(救急外来の来院のうち救急車・ドクターヘリ・ドクターカー)。 */
export function countEmergencyTransports(emergencies: fhir4.Encounter[], fiscalYear: number): number {
  return emergencies.filter(
    (encounter) =>
      encounter.status !== "entered-in-error" &&
      AMBULANCE_ARRIVAL_MODES.includes(emergencyArrivalMode(encounter) ?? "") &&
      inFiscalYear(encounter.period?.start?.slice(0, 10), fiscalYear),
  ).length;
}

/** (4) 年度の救急搬送からの入院件数を、入院日の床の届出単位ごとに数える。 */
export function countAmbulanceAdmissionsByUnit(
  admissions: fhir4.Encounter[],
  fiscalYear: number,
  units: AcuityUnit[],
): Map<string, number> {
  const bedUnit = unitBedIndex(units);
  const counts = new Map<string, number>();
  for (const encounter of admissions) {
    if (!inFiscalYear(encounter.period?.start?.slice(0, 10), fiscalYear)) continue;
    if (!encounterAdmissionRoute(encounter).ambulance) continue;
    const firstBed = encounterBedSegments(encounter)[0]?.bedId;
    const unitId = firstBed ? bedUnit.get(firstBed) : undefined;
    if (!unitId) continue;
    counts.set(unitId, (counts.get(unitId) ?? 0) + 1);
  }
  return counts;
}

/** 届出単位 1 つの係数の計算に使った値。 */
export interface UnitCoefficient {
  unitId: string;
  /** (1) 救急搬送受入件数。 */
  transports: number;
  /** (2) 係数を算入する全区分の救急搬送からの入院件数。 */
  admissionsTotal: number;
  /** (3) 届出病床数。 */
  beds: number;
  /** (4) この単位の救急搬送からの入院件数。 */
  admissions: number;
  /** (5) 係数(上限 0.1)。係数を算入しない区分は 0。 */
  coefficient: number;
}

/**
 * 年度の係数を届出単位ごとに組む。記録から数えた件数に、施設設定の年度の上書き(あれば優先)を重ねる。
 * 係数を算入しない区分は (2) に入れず、係数も 0。
 */
export function emergencyCoefficients(args: {
  fiscalYear: number;
  units: AcuityUnit[];
  emergencies: fhir4.Encounter[];
  admissions: fhir4.Encounter[];
  override: AcuityEmergencyYearSetting | undefined;
}): Map<string, UnitCoefficient> {
  const { fiscalYear, units, emergencies, admissions, override } = args;
  const transports = override?.transports ?? countEmergencyTransports(emergencies, fiscalYear);
  const counted = countAmbulanceAdmissionsByUnit(admissions, fiscalYear, units);
  const admissionsOf = (unit: AcuityUnit) => override?.admissions?.[unit.id] ?? counted.get(unit.id) ?? 0;
  const admissionsTotal = units.filter((unit) => unit.coefficientApplies).reduce((sum, unit) => sum + admissionsOf(unit), 0);
  const result = new Map<string, UnitCoefficient>();
  for (const unit of units) {
    const own = admissionsOf(unit);
    const coefficient =
      unit.coefficientApplies && admissionsTotal > 0 && unit.beds > 0
        ? Math.min(COEFFICIENT_CAP, (transports * (own / admissionsTotal)) / unit.beds * COEFFICIENT_PER_CASE)
        : 0;
    result.set(unit.id, { unitId: unit.id, transports, admissionsTotal, beds: unit.beds, admissions: own, coefficient });
  }
  return result;
}

/** 割合指数(%)。該当患者割合(%)に係数(比率)を % に直して足す。 */
export function ratioIndexPercent(ratioPercent: number | null, coefficient: number): number | null {
  return ratioPercent === null ? null : ratioPercent + coefficient * 100;
}

/** 割合(%)。分母が 0 なら null。 */
export function percentOf(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}
