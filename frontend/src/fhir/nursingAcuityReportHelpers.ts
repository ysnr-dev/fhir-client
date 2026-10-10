import { addDays, addMonths, diffDays } from "../lib/dates";
import { encounterBedSegments } from "./bedScheduleHelpers";
import { encounterDepartmentId } from "./encounterHelpers";
import {
  acuityDate,
  acuityPatientId,
  acuityScores,
  meetsAcuityCriterion,
  parseAcuityObservation,
} from "./nursingAcuityHelpers";
import type { AcuityUnit } from "./nursingAcuityUnitHelpers";
import { percentOf, ratioIndexPercent, type UnitCoefficient } from "./nursingAcuityCoefficientHelpers";

// 届出様式(docs/nursing-acuity-design.md §10)。様式10(一般病棟用の届出書添付書類)と様式43(救命救急・ICU・HCU)
// の欄を、様式の並びのまま { label, value } に組む。厚生局の様式への転記は手作業(画面・CSV・xlsx で出す)。
//
// 入院患者延べ数は様式の定義で数える: 退院した日の患者を含めない(床の区間の夜で数える)、15 歳未満・産科の患者
// (必要度Ⅱは歯科も)を除く。短期滞在手術等の患者は「対象外」の評価で代える。結核病棟の除外は機械で判定できないので
// 持たない。適用した除外は表に出す。

export interface ReportRow {
  label: string;
  value: string | number;
}

/** 1 か月ぶんの入院・評価(届出タブが月ごとに読む)。 */
export interface AcuityReportMonthInput {
  month: string;
  encounters: fhir4.Encounter[];
  patientsById: Map<string, fhir4.Patient>;
  /** 診療科 Organization.id → 診療科コード(SS-MIX2)。産科・歯科の除外に使う。 */
  departmentCodes: Map<string, string>;
  /** その月の、この単位で付けた評価。 */
  observations: fhir4.Observation[];
}

export interface AcuityReportMonth {
  month: string;
  /** 入院患者延べ数(除外後)。 */
  patientDays: number;
  /** 割合1・割合2に該当した延べ数。 */
  met1: number;
  met2: number;
  /** 除いた延べ数。 */
  excluded: { under15: number; obstetrics: number; dental: number; evaluation: number; unevaluated: number };
}

const OBSTETRICS_CODE = /^(23|24)/;
const DENTAL_CODE = /^90/;

function ageAt(birthDate: string | undefined, day: string): number | null {
  if (!birthDate) return null;
  const years = Number(day.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return day.slice(5) < birthDate.slice(5) ? years - 1 : years;
}

/** 月の初日と末日。 */
export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}

/** 月を n か月さかのぼった月の並び(古い順)。 */
export function monthsEndingAt(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(`${month}-01`, i - (count - 1)).slice(0, 7));
}

/**
 * 1 か月ぶんの延べ数。患者 × 日(夜)を単位のベッドの区間から起こし、除外を当てたうえで、その日の評価で
 * 該当を数える。評価の無い患者 × 日は分母に数え、該当には数えない(未評価の延べ数を excluded.unevaluated に出す)。
 * today より先の日は数えない(続いている入院を月末まで数えてしまうため)。
 */
export function acuityReportMonth(unit: AcuityUnit, input: AcuityReportMonthInput, today: string): AcuityReportMonth {
  const { from, to: monthEnd } = monthRange(input.month);
  const to = monthEnd < today ? monthEnd : today;
  const byDay = new Map<string, fhir4.Observation>();
  for (const observation of input.observations) {
    byDay.set(`${acuityPatientId(observation)}:${acuityDate(observation)}`, observation);
  }
  const result: AcuityReportMonth = {
    month: input.month,
    patientDays: 0,
    met1: 0,
    met2: 0,
    excluded: { under15: 0, obstetrics: 0, dental: 0, evaluation: 0, unevaluated: 0 },
  };
  for (const encounter of input.encounters) {
    const department = input.departmentCodes.get(encounterDepartmentId(encounter) ?? "") ?? "";
    const obstetrics = OBSTETRICS_CODE.test(department);
    const dental = unit.method === "II" && DENTAL_CODE.test(department);
    for (const segment of encounterBedSegments(encounter)) {
      if (!unit.bedIds.has(segment.bedId)) continue;
      // 退院日・移動日(until)は数えない。
      const last = segment.until ? addDays(segment.until, -1) : to;
      const start = segment.start < from ? from : segment.start;
      if (start > to || diffDays(start, last) < 0) continue;
      const birthDate = input.patientsById.get(segment.patientId)?.birthDate;
      for (let day = start; day <= last && day <= to; day = addDays(day, 1)) {
        const age = ageAt(birthDate, day);
        if (age !== null && age < 15) {
          result.excluded.under15 += 1;
          continue;
        }
        if (obstetrics) {
          result.excluded.obstetrics += 1;
          continue;
        }
        if (dental) {
          result.excluded.dental += 1;
          continue;
        }
        const observation = byDay.get(`${segment.patientId}:${day}`);
        if (!observation) {
          result.excluded.unevaluated += 1;
          result.patientDays += 1;
          continue;
        }
        const { form, values } = parseAcuityObservation(observation);
        if (values.excluded) {
          result.excluded.evaluation += 1;
          continue;
        }
        result.patientDays += 1;
        const scores = acuityScores(form, values);
        if (meetsAcuityCriterion(scores, unit.criteria.ratio1, values.checks)) result.met1 += 1;
        if (meetsAcuityCriterion(scores, unit.criteria.ratio2, values.checks)) result.met2 += 1;
      }
    }
  }
  return result;
}

function sum(months: AcuityReportMonth[], pick: (m: AcuityReportMonth) => number): number {
  return months.reduce((total, m) => total + pick(m), 0);
}

function percentText(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

function periodLabel(months: AcuityReportMonth[]): string {
  const first = monthRange(months[0].month).from;
  const last = monthRange(months[months.length - 1].month).to;
  return `${first} 〜 ${last}`;
}

function exclusionRows(months: AcuityReportMonth[], unit: AcuityUnit): ReportRow[] {
  const rows: ReportRow[] = [
    { label: "除外: 退院日の患者", value: "適用(退院日・転出日は数えない)" },
    { label: "除外: 15歳未満の患者(延べ数)", value: sum(months, (m) => m.excluded.under15) },
    { label: "除外: 産科の患者(延べ数)", value: sum(months, (m) => m.excluded.obstetrics) },
  ];
  if (unit.method === "II") rows.push({ label: "除外: 歯科の患者(延べ数)", value: sum(months, (m) => m.excluded.dental) });
  rows.push(
    { label: "除外: 対象外の評価(延べ数)", value: sum(months, (m) => m.excluded.evaluation) },
    { label: "未評価の延べ数(分母に含む)", value: sum(months, (m) => m.excluded.unevaluated) },
    { label: "除外: 結核病棟の患者", value: "未対応(手作業で除く)" },
  );
  return rows;
}

/** 様式10(一般病棟用)の欄。months は直近 3 月(古い順)。 */
export function form10Rows(args: {
  unit: AcuityUnit;
  months: AcuityReportMonth[];
  coefficient: UnitCoefficient | undefined;
  fiscalYear: number;
  trainingDate: string;
}): ReportRow[] {
  const { unit, months, coefficient, fiscalYear, trainingDate } = args;
  const days = sum(months, (m) => m.patientDays);
  const met1 = sum(months, (m) => m.met1);
  const met2 = sum(months, (m) => m.met2);
  const ratio1 = percentOf(met1, days);
  const ratio2 = percentOf(met2, days);
  const useRatio2 = unit.criteria.ratio2.length > 0;
  const coef = coefficient?.coefficient ?? 0;
  const rows: ReportRow[] = [
    { label: "1 評価票", value: `重症度、医療・看護必要度${unit.method === "II" ? "Ⅱ" : "Ⅰ"}` },
    { label: "2 届出事項 届出区分", value: unit.category?.label ?? "" },
    { label: "2 届出事項 届出病床数", value: unit.beds },
    { label: "2 直近3月の期間", value: periodLabel(months) },
    { label: "2 ア 入院患者延べ数", value: days },
    { label: "2 イ 割合1(基準①)に該当する患者延べ数", value: met1 },
    { label: "2 ウ 基準①の該当患者割合(イ/ア)", value: percentText(ratio1) },
  ];
  if (useRatio2) {
    rows.push(
      { label: "2 エ 割合2(基準②)に該当する患者延べ数", value: met2 },
      { label: "2 オ 基準②の該当患者割合(エ/ア)", value: percentText(ratio2) },
    );
  }
  if (unit.coefficientApplies) {
    rows.push(
      { label: "3 ア 救急患者応需係数の算出年度", value: `${fiscalYear}年度(${fiscalYear}-04-01 〜 ${fiscalYear + 1}-03-31)` },
      { label: "3 (1) 救急搬送受入件数", value: coefficient?.transports ?? 0 },
      { label: "3 (2) 救急搬送からの入院件数(係数を算入する全区分)", value: coefficient?.admissionsTotal ?? 0 },
      { label: "3 イ (3) 当該区分の病床数", value: coefficient?.beds ?? unit.beds },
      { label: "3 イ (4) 当該区分の救急搬送からの入院件数", value: coefficient?.admissions ?? 0 },
      { label: "3 イ (5) 救急患者応需係数", value: coef.toFixed(4) },
      { label: "3 ウ 基準①の割合指数", value: percentText(ratioIndexPercent(ratio1, coef)) },
    );
    if (useRatio2) rows.push({ label: "3 ウ 基準②の割合指数", value: percentText(ratioIndexPercent(ratio2, coef)) });
  }
  rows.push({ label: "基準値①(%)", value: unit.thresholds[0] ?? "-" });
  if (useRatio2) rows.push({ label: "基準値②(%)", value: unit.thresholds[1] ?? "-" });
  rows.push({ label: "4 院内研修の実施日", value: trainingDate });
  return [...rows, ...exclusionRows(months, unit)];
}

/** 様式43(救命救急・ICU・HCU)の欄。months は直近 1 月。 */
export function form43Rows(args: { unit: AcuityUnit; months: AcuityReportMonth[]; trainingDate: string }): ReportRow[] {
  const { unit, months, trainingDate } = args;
  const days = sum(months, (m) => m.patientDays);
  const met1 = sum(months, (m) => m.met1);
  const met2 = sum(months, (m) => m.met2);
  const useRatio2 = unit.criteria.ratio2.length > 0;
  const rows: ReportRow[] = [
    { label: "届出区分", value: unit.category?.label ?? "" },
    { label: "病床数", value: unit.beds },
    { label: "直近1月の期間", value: periodLabel(months) },
    { label: "① 入室患者延べ数", value: days },
    { label: `② ${useRatio2 ? "【割合①】" : ""}基準を満たす患者延べ数`, value: met1 },
    { label: `③ ${useRatio2 ? "【割合①】" : ""}割合(②/①)`, value: percentText(percentOf(met1, days)) },
  ];
  if (useRatio2) {
    rows.push(
      { label: "② 【割合②】基準を満たす患者延べ数", value: met2 },
      { label: "③ 【割合②】割合(②/①)", value: percentText(percentOf(met2, days)) },
    );
  }
  rows.push({ label: "基準値①(%)", value: unit.thresholds[0] ?? "-" });
  if (useRatio2) rows.push({ label: "基準値②(%)", value: unit.thresholds[1] ?? "-" });
  rows.push({ label: "院内研修の実施日", value: trainingDate });
  return [...rows, ...exclusionRows(months, unit)];
}

/** 届出単位に使う様式(一般病棟用は様式10、ICU・HCU 用は様式43)と算出期間の月数。 */
export function reportFormOf(unit: AcuityUnit): { form: "10" | "43"; months: number } {
  return unit.form.rules.codeForm === "general" ? { form: "10", months: 3 } : { form: "43", months: 1 };
}
