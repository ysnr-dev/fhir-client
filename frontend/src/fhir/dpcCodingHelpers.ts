import type { DpcCodingInputs, DpcCodingOverrides } from "../api/masterClient";
import type { Dpc1PayloadNo, Dpc1Values } from "./dpcForm1/types";
import { fromDpcDate } from "./dpcForm1Draft";

// 診断群分類(14 桁)の判定(POST /master/dpc/coding)に渡す値を、入力中の様式1 から作る。
// backend は様式1 の定義表を知らないので、意味のある値(ICD-10・年齢の元・重症度の点数)に
// 直して渡す。未入力は送らない(backend はその分岐を未確定にして候補を広げる)。

const DPC_UNKNOWN = new Set(["999", "99999", "9999"]);

function get(values: Dpc1Values, code: string, payload: Dpc1PayloadNo, index = 0): string {
  return values.records[code]?.[index]?.p[payload]?.trim() ?? "";
}

function integer(text: string): number | undefined {
  return /^\d+$/.test(text) && !DPC_UNKNOWN.has(text) ? Number(text) : undefined;
}

function digits(text: string, length: number): string[] | null {
  return text.length === length ? text.split("") : null;
}

/** 肺炎の重症度分類(7 桁: BUN・SpO2・意識・血圧・免疫不全・規定因子・院内/市中)から A-DROP と区分。 */
function pneumonia(values: Dpc1Values, age: number | null): Pick<DpcCodingInputs, "adrop" | "pneumonia_category"> {
  const parts = digits(get(values, "M040020", 2), 7);
  if (!parts) return {};
  const sex = get(values, "A000010", 2);
  // A-DROP の A(男性 70 歳以上・女性 75 歳以上)は生年月日・性別から数える。
  const agePoint = age === null || !sex ? null : age >= (sex === "1" ? 70 : 75) ? 1 : 0;
  const [bun, spo2, consciousness, pressure, , , category] = parts;
  const adrop =
    agePoint === null ? undefined : agePoint + Number(bun) + (Number(spo2) >= 1 ? 1 : 0) + Number(consciousness) + Number(pressure);
  return { adrop, pneumonia_category: category };
}

/** Child-Pugh(5 項目 × 1〜3 点)の合計。 */
function childPugh(values: Dpc1Values): number | undefined {
  const parts = digits(get(values, "M060010", 2), 5);
  return parts && parts.every((d) => /[1-3]/.test(d)) ? parts.reduce((sum, d) => sum + Number(d), 0) : undefined;
}

/** 急性膵炎の重症度(A 予後因子・B 造影 CT)。 */
function pancreatitis(values: Dpc1Values): Pick<DpcCodingInputs, "pancreatitis_a" | "pancreatitis_b"> {
  const parts = digits(get(values, "M060020", 2), 2);
  return parts ? { pancreatitis_a: Number(parts[0]), pancreatitis_b: Number(parts[1]) } : {};
}

/** JCS("10R" など)の数値部分。0 は意識障害なし。 */
function jcs(values: Dpc1Values): number | undefined {
  const text = get(values, "JCS0010", 2);
  const match = /^(\d+)/.exec(text);
  return match && !DPC_UNKNOWN.has(text) ? Number(match[1]) : undefined;
}

export function dpcCodingInputsFromForm1(values: Dpc1Values, age: number | null): DpcCodingInputs {
  const surgeryRows = values.records.A007010 ?? [];
  const surgeries = surgeryRows
    .map((row) => ({
      date: fromDpcDate(row.p[1] ?? "") || undefined,
      k_code: row.p[2]?.trim() ?? "",
      name: row.p[9],
    }))
    .filter((s) => s.k_code);
  const comorbidities = ["A006040", "A006050"].flatMap((code) =>
    (values.records[code] ?? []).map((row) => row.p[2]?.trim() ?? "").filter(Boolean),
  );
  const route = get(values, "A000020", 2);
  const birthDate = fromDpcDate(get(values, "A000010", 1));

  return {
    icd10: get(values, "A006030", 2) || undefined,
    comorbidity_icd10s: comorbidities,
    birth_date: birthDate || undefined,
    jcs: jcs(values),
    birth_weight: integer(get(values, "A003010", 2)),
    pregnancy_weeks: integer(get(values, "A002010", 3)),
    delivery_bleeding: integer(get(values, "M120010", 3)),
    burn_index: integer(get(values, "M160010", 2)),
    gaf: integer(get(values, "M170010", 2)),
    stroke_onset: get(values, "M010010", 3) || undefined,
    child_pugh: childPugh(values),
    ...pneumonia(values, age),
    ...pancreatitis(values),
    transfer: route ? route === "4" : undefined,
    bilateral: surgeryRows.length ? surgeryRows.some((row) => row.p[5] === "3") : undefined,
    reoperation: surgeryRows.length ? surgeryRows.some((row) => row.p[4] === "2") : undefined,
    surgeries,
  };
}

export const EMPTY_DPC_OVERRIDES: DpcCodingOverrides = { branches: {}, accepted: [], rejected: [] };

/** 候補・実施記録のコードを確定・除外・元に戻す。 */
export function toggleDpcItem(
  overrides: DpcCodingOverrides,
  code: string,
  action: "accept" | "reject" | "reset",
): DpcCodingOverrides {
  const accepted = overrides.accepted.filter((c) => c !== code);
  const rejected = overrides.rejected.filter((c) => c !== code);
  if (action === "accept") accepted.push(code);
  if (action === "reject") rejected.push(code);
  return { ...overrides, accepted, rejected };
}

export function setDpcBranch(
  overrides: DpcCodingOverrides,
  key: string,
  value: string,
): DpcCodingOverrides {
  const branches = { ...overrides.branches };
  if (value) branches[key] = value;
  else delete branches[key];
  return { ...overrides, branches };
}

/** 推定包括額(円)。点数 × 医療機関別係数 × 10 円。係数が無ければ null。 */
export function dpcEstimatedYen(points: number | null | undefined, coefficient: string | undefined): number | null {
  if (points == null || !coefficient) return null;
  return Math.round(points * Number(coefficient) * 10);
}

