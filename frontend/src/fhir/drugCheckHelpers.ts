import type { DrugDoseRule, DrugInteraction } from "../api/masterClient";
import { convertDose, type MedicineDoseConversionMap } from "./doseConversionHelpers";
import {
  ingredientKey,
  type ActiveMedication,
  type MedicationRp,
  type MedicationWarning,
} from "./medicationSafetyHelpers";

// 施設マスタによる薬剤チェック(docs/drug-check-master-design.md)。
//
//   相互作用  … 併用禁忌・併用注意。フォームの別の行と、投与中の処方・持参薬が相手
//   用量規則  … 年齢・腎機能の条件と、1 回量・1 日量の上限(体重あたりも可)
//
// 薬はマスタ側で YJ コードの先頭 4〜7 桁で書き、薬剤行の成分キー(YJ 上 7 桁)の前方一致で
// 当てる。**登録は止めない**(`medicationSafetyHelpers` と同じ)。

/** 薬剤行の投与量。比べられない量(外用の総量、頓用の 1 日量など)は null。 */
export interface LineDose {
  /** 1 日量。 */
  daily: number | null;
  /** 1 回量。 */
  single: number | null;
  /** `daily` / `single` の単位(薬価算定単位か、レジメン由来の力価の単位)。 */
  unit: string;
}

export interface CheckedLine {
  medicine: MedicationRp["medicines"][number]["medicine"];
  dose?: LineDose | null;
}

export interface CheckedRp {
  medicines: CheckedLine[];
}

/** 用量規則の条件に使う患者の値。分からないものは null。 */
export interface PatientFactors {
  age: number | null;
  weight: { value: number; date: string } | null;
  egfr: number | null;
  ccr: number | null;
}

const SEVERITY_LABELS: Record<DrugInteraction["severity"], string> = {
  contraindicated: "禁忌",
  caution: "注意",
};

const RENAL_LABELS: Record<"egfr" | "ccr", string> = { egfr: "eGFR", ccr: "CCr" };

/** マスタのコード(YJ 先頭 4〜7 桁)が成分キーに当たるか。 */
function codeMatches(key: string, code: string): boolean {
  return Boolean(code) && key.startsWith(code);
}

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

interface Partner {
  key: string;
  name: string;
  /** どこにある薬か(「RP2」「投与中」「持参薬」)。 */
  where: string;
}

/**
 * 1 つの薬剤行に対する相互作用の警告。相手はフォームの別の行と投与中の薬。
 * 同じ規則・同じ相手は 1 回だけ出す。
 */
function interactionWarnings(
  key: string,
  partners: Partner[],
  interactions: DrugInteraction[],
): MedicationWarning[] {
  const warnings: MedicationWarning[] = [];
  const seen = new Set<string>();

  for (const rule of interactions) {
    const selfIsA = codeMatches(key, rule.code_a);
    const selfIsB = codeMatches(key, rule.code_b);
    if (!selfIsA && !selfIsB) continue;

    for (const partner of partners) {
      const hit =
        (selfIsA && codeMatches(partner.key, rule.code_b)) ||
        (selfIsB && codeMatches(partner.key, rule.code_a));
      if (!hit) continue;
      const dedupe = `${rule.id}:${partner.key}:${partner.where}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const label = rule.severity === "contraindicated" ? "併用禁忌" : "併用注意";
      warnings.push({
        kind: "interaction",
        text: `${label}: ${partner.name}（${partner.where}）`,
        high: rule.severity === "contraindicated",
        detail: [`${rule.name_a} × ${rule.name_b}`, rule.note].filter(Boolean).join("\n"),
      });
    }
  }
  return warnings;
}

function ageConditionText(rule: DrugDoseRule): string {
  if (rule.age_from !== null && rule.age_to !== null) return `${rule.age_from} 歳以上 ${rule.age_to} 歳未満`;
  if (rule.age_from !== null) return `${rule.age_from} 歳以上`;
  if (rule.age_to !== null) return `${rule.age_to} 歳未満`;
  return "";
}

/** 規則の条件を患者に当てた結果。当てはまらなければ null(その規則は出さない)。 */
type ConditionResult =
  | { status: "met"; label: string }
  | { status: "unknown"; label: string; missing: string };

function evaluateConditions(rule: DrugDoseRule, patient: PatientFactors): ConditionResult | null {
  const labels: string[] = [];
  const missing: string[] = [];

  const ageText = ageConditionText(rule);
  if (ageText) {
    if (patient.age === null) {
      missing.push("年齢");
      labels.push(ageText);
    } else {
      if (rule.age_from !== null && patient.age < rule.age_from) return null;
      if (rule.age_to !== null && patient.age >= rule.age_to) return null;
      labels.push(`${patient.age} 歳（${ageText}）`);
    }
  }

  if (rule.renal_index && rule.renal_below !== null) {
    const name = RENAL_LABELS[rule.renal_index];
    const below = Number(rule.renal_below);
    const value = patient[rule.renal_index];
    const text = `${name} ${formatNumber(below)} 未満`;
    if (value === null) {
      missing.push(name);
      labels.push(text);
    } else {
      if (value >= below) return null;
      labels.push(`${name} ${formatNumber(value)}（${formatNumber(below)} 未満）`);
    }
  }

  const label = labels.join("・");
  return missing.length > 0
    ? { status: "unknown", label, missing: missing.join("・") }
    : { status: "met", label };
}

/** 規則の上限と行の投与量を比べる。比べられる上限が無ければ空。 */
function limitWarnings(
  rule: DrugDoseRule,
  condition: string,
  medicineCode: string,
  dose: LineDose | null | undefined,
  patient: PatientFactors,
  conversions: MedicineDoseConversionMap | undefined,
): MedicationWarning[] {
  const unit = rule.dose_unit ?? "";
  const prefix = condition ? ` ${condition}` : "";
  const limits: { kind: "1日量" | "1回量"; max: number; amount: number | null }[] = [];
  if (rule.max_daily_dose !== null && dose?.daily != null) {
    limits.push({ kind: "1日量", max: Number(rule.max_daily_dose), amount: dose.daily });
  }
  if (rule.max_single_dose !== null && dose?.single != null) {
    limits.push({ kind: "1回量", max: Number(rule.max_single_dose), amount: dose.single });
  }
  if (limits.length === 0 || !dose) return [];

  const perKgSuffix = rule.per_kg ? "/kg" : "";
  if (rule.per_kg && !patient.weight) {
    return [
      {
        kind: "dose",
        text: `体重が無いため上限 ${limits.map((l) => `${l.kind} ${formatNumber(l.max)}${unit}/kg`).join("・")} を確認できません`,
        high: false,
        detail: rule.message ?? undefined,
      },
    ];
  }

  const warnings: MedicationWarning[] = [];
  for (const limit of limits) {
    const amount = convertDose(limit.amount!, dose.unit, medicineCode, unit, conversions);
    if (amount === null) {
      warnings.push({
        kind: "dose",
        text: `${dose.unit} を ${unit} に換算できず、${limit.kind}の上限 ${formatNumber(limit.max)}${unit}${perKgSuffix} を確認できません`,
        high: false,
        detail: "投与量換算マスタに換算行を登録すると確認できます。",
      });
      continue;
    }
    const weight = rule.per_kg ? patient.weight!.value : 1;
    const max = limit.max * weight;
    // 換算の丸めで上限ちょうどが超過に見えないよう、わずかな誤差は許す。
    if (amount <= max * 1.0001) continue;

    const basis = rule.per_kg
      ? `${formatNumber(limit.max)}${unit}/kg × ${formatNumber(weight)}kg（${patient.weight!.date}）`
      : "";
    warnings.push({
      kind: "dose",
      text: `上限超過${prefix}: ${limit.kind} ${formatNumber(amount)}${unit} > ${formatNumber(max)}${unit}`,
      high: true,
      detail: [basis, rule.message].filter(Boolean).join("\n") || undefined,
    });
  }
  return warnings;
}

function doseRuleWarnings(
  line: CheckedLine,
  key: string,
  doseRules: DrugDoseRule[],
  patient: PatientFactors,
  conversions: MedicineDoseConversionMap | undefined,
): MedicationWarning[] {
  const medicine = line.medicine!;
  const warnings: MedicationWarning[] = [];

  for (const rule of doseRules) {
    if (!codeMatches(key, rule.code)) continue;
    if (rule.dosage_form && rule.dosage_form !== medicine.dosage_form) continue;

    const condition = evaluateConditions(rule, patient);
    if (!condition) continue;

    if (condition.status === "unknown") {
      warnings.push({
        kind: "dose",
        text: `${condition.missing}が無いため確認できません: ${condition.label}の${SEVERITY_LABELS[rule.severity]}`,
        high: false,
        detail: rule.message ?? undefined,
      });
      continue;
    }

    const hasLimit = rule.max_daily_dose !== null || rule.max_single_dose !== null;
    if (hasLimit) {
      warnings.push(
        ...limitWarnings(rule, condition.label, medicine.medicine_code, line.dose, patient, conversions),
      );
    } else {
      warnings.push({
        kind: "dose",
        text: `${SEVERITY_LABELS[rule.severity]} ${condition.label}: ${rule.message ?? ""}`,
        high: rule.severity === "contraindicated",
      });
    }
  }
  return warnings;
}

/**
 * フォームの全薬剤行ぶんの施設マスタの警告を、`rps` と同じ形([RP][薬剤])で返す。
 * YJ コードを持たない薬剤は成分キーが無いので照合できず黙って通る(重複投与と同じ制約)。
 */
export function buildDrugCheckWarnings(args: {
  rps: CheckedRp[];
  active: ActiveMedication[];
  interactions: DrugInteraction[];
  doseRules: DrugDoseRule[];
  patient: PatientFactors;
  conversions: MedicineDoseConversionMap | undefined;
  excludeOrderId?: string;
  excludeBroughtIds?: string[];
}): MedicationWarning[][][] {
  const {
    rps,
    active,
    interactions,
    doseRules,
    patient,
    conversions,
    excludeOrderId,
    excludeBroughtIds = [],
  } = args;

  const formLines = rps.flatMap((rp, rpIndex) =>
    rp.medicines.flatMap((line, medIndex) => {
      const key = ingredientKey(line.medicine);
      return key && line.medicine
        ? [{ rpIndex, medIndex, key, name: line.medicine.name }]
        : [];
    }),
  );
  const ongoing: Partner[] = active
    .filter((a) => (a.brought ? !excludeBroughtIds.includes(a.orderId) : a.orderId !== excludeOrderId))
    .map((a) => ({ key: a.ingredient, name: a.name, where: a.brought ? "持参薬" : "投与中" }));

  return rps.map((rp, rpIndex) =>
    rp.medicines.map((line, medIndex) => {
      const key = ingredientKey(line.medicine);
      if (!key || !line.medicine) return [];

      const partners: Partner[] = [
        ...formLines
          .filter((l) => l.rpIndex !== rpIndex || l.medIndex !== medIndex)
          .map((l) => ({ key: l.key, name: l.name, where: `RP${l.rpIndex + 1}` })),
        ...ongoing,
      ];
      return [
        ...interactionWarnings(key, partners, interactions),
        ...doseRuleWarnings(line, key, doseRules, patient, conversions),
      ];
    }),
  );
}
