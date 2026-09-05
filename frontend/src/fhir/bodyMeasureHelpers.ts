/**
 * 身長・体重(と BMI)、腎機能の最新値。
 *
 * どちらもプロファイルの「身体」区画に**読み取り専用**で出す。本体は
 * バイタル(身長・体重)と検体検査の結果(クレアチニン)にあり、プロファイルは
 * そこから最新値を引くだけ(同じ情報を 2 経路に持たない、§1 の方針)。
 */

const LOINC = "http://loinc.org";
const JLAC11_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11";

/** 身長・体重の LOINC。バイタル(vitalHelpers.ts)と同じコード。 */
export const HEIGHT_LOINC = "8302-2";
export const WEIGHT_LOINC = "29463-7";

/**
 * 腎機能に読む検査の JLAC11 分析物コード(先頭 5 桁)。感染症と同じ考え方で、
 * 材料・測定法の違いを吸収するために分析物で引き当てる。
 *
 * eGFR は配布マスタに項目が無く、血清クレアチニンと年齢・性別から算出する
 * (日本腎臓学会の推算式)。シスタチン C は薬用量調整で使うことがあるので拾うが、
 * eGFR の算出には使わない(クレアチニンの式と混ぜない)。
 */
export const CREATININE_ANALYTE = "C3002";
export const CYSTATIN_C_ANALYTE = "C3003";
const ANALYTE_LENGTH = 5;

function loincOf(observation: fhir4.Observation): string {
  return observation.code?.coding?.find((c) => c.system === LOINC)?.code ?? "";
}

function analyteOf(observation: fhir4.Observation): string {
  const jlac = observation.code?.coding?.find((c) => c.system === JLAC11_SYSTEM)?.code ?? "";
  return jlac.length >= ANALYTE_LENGTH ? jlac.slice(0, ANALYTE_LENGTH) : "";
}

/** 確認日の新しい順。同じ項目が複数あれば最新を採る。 */
function newestFirst(observations: fhir4.Observation[]): fhir4.Observation[] {
  return [...observations].sort((a, b) =>
    (b.effectiveDateTime ?? "").localeCompare(a.effectiveDateTime ?? ""),
  );
}

export interface Measurement {
  value: number;
  unit: string;
  date: string;
}

function measurementOf(observation: fhir4.Observation | undefined): Measurement | null {
  const quantity = observation?.valueQuantity;
  if (quantity?.value === undefined) return null;

  return {
    value: quantity.value,
    unit: quantity.unit ?? "",
    date: observation?.effectiveDateTime?.slice(0, 10) ?? "",
  };
}

export interface BodyMeasureSummary {
  height: Measurement | null;
  weight: Measurement | null;
  /** 身長と体重の両方があるときだけ出す。 */
  bmi: number | null;
}

/** 身長・体重の最新値と BMI。小児は変わるので、測定日を必ず添えて使う。 */
export function summarizeBodyMeasures(observations: fhir4.Observation[]): BodyMeasureSummary {
  const sorted = newestFirst(observations);
  const height = measurementOf(sorted.find((o) => loincOf(o) === HEIGHT_LOINC));
  const weight = measurementOf(sorted.find((o) => loincOf(o) === WEIGHT_LOINC));

  // 身長と体重の測定日が離れていても BMI は出す(体重だけ測り直すのが普通)。
  // 読む側が判断できるよう、日付はそれぞれの測定日を別に出す。
  const bmi =
    height && weight && height.value > 0
      ? Math.round((weight.value / (height.value / 100) ** 2) * 10) / 10
      : null;

  return { height, weight, bmi };
}

/** 「170.0cm（2026-09-05）」。値が無ければ空。 */
export function measurementLabel(measurement: Measurement | null): string {
  if (!measurement) return "";
  return `${measurement.value}${measurement.unit}`;
}

export interface RenalSummary {
  creatinine: Measurement | null;
  cystatinC: Measurement | null;
  /** 血清クレアチニンから算出した eGFR。算出できなければ null。 */
  egfr: number | null;
  /** eGFR を算出できなかった理由。画面に出して、黙って空欄にしない。 */
  egfrUnavailable: string;
}

/**
 * 推算 GFR(日本腎臓学会の式)。
 *   男性: 194 × Cr^-1.094 × 年齢^-0.287
 *   女性: 上記 × 0.739
 * 性別か年齢が分からない、またはクレアチニンが無いときは算出しない
 * (薬用量の判断に使う値なので、当てずっぽうを出さない)。
 */
function calculateEgfr(
  creatinine: number,
  age: number | undefined,
  gender: string | undefined,
): { egfr: number | null; reason: string } {
  if (gender !== "male" && gender !== "female") {
    return { egfr: null, reason: "性別が未登録のため算出できません" };
  }
  if (age === undefined || age <= 0) {
    return { egfr: null, reason: "生年月日が未登録のため算出できません" };
  }
  if (creatinine <= 0) return { egfr: null, reason: "" };

  const base = 194 * creatinine ** -1.094 * age ** -0.287;
  const value = gender === "female" ? base * 0.739 : base;
  return { egfr: Math.round(value * 10) / 10, reason: "" };
}

export function summarizeRenal(
  observations: fhir4.Observation[],
  patient: { age?: number; gender?: string },
): RenalSummary {
  const sorted = newestFirst(observations);
  const creatinine = measurementOf(sorted.find((o) => analyteOf(o) === CREATININE_ANALYTE));
  const cystatinC = measurementOf(sorted.find((o) => analyteOf(o) === CYSTATIN_C_ANALYTE));

  if (!creatinine) return { creatinine, cystatinC, egfr: null, egfrUnavailable: "" };

  const { egfr, reason } = calculateEgfr(creatinine.value, patient.age, patient.gender);
  return { creatinine, cystatinC, egfr, egfrUnavailable: reason };
}
