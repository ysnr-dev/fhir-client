import type { DrugDiseaseRule, DrugDoseRule, DrugInteraction } from "../api/masterClient";
import { convertDose, type MedicineDoseConversionMap } from "./doseConversionHelpers";
import {
  type DrugIdentity,
  EMPTY_INGREDIENT_INDEX,
  type IngredientIndex,
  ruleCodeKind,
  ruleCodeMatches,
  ruleComponents,
} from "./ingredientIndex";
import {
  activeIdentity,
  medicineIdentity,
  type ActiveMedication,
  type MedicationRp,
  type MedicationWarning,
} from "./medicationSafetyHelpers";

// 施設マスタによる薬剤チェック(docs/drug-check-master-design.md)。
//
//   相互作用  … 併用禁忌・併用注意。フォームの別の行と、投与中の処方・持参薬が相手
//   用量規則  … 年齢・腎機能の条件と、1 回量・1 日量・投与日数の上限(体重あたりも可)
//               1 日量は同じ成分を含むフォームの行を足し合わせて比べる
//               累積の上限はここでは見ない(化学療法の適用で `regimenCheckHelpers` が積算する)
//   病名      … 患者の活動中の病名(ICD-10 の前方一致)との禁忌・注意
//
// 薬はマスタ側で YJ コードの先頭 4〜7 桁、成分マスタの成分(`I` + 成分の ID)、ATC 分類のいずれかで書く。
// YJ は薬剤行の成分キー(YJ 上 7 桁)の前方一致、成分と ATC 分類は薬剤行の成分で当てる(`ingredientIndex.ts`)。
// **登録は止めない**(`medicationSafetyHelpers` と同じ)。

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
  /** 投与日数。日数を持つ内服の行だけ。 */
  days?: number | null;
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

/** 病名の照合に使う患者の病名 1 件。code は ICD-10(点なし)。 */
export interface PatientDiagnosis {
  code: string;
  name: string;
}

const SEVERITY_LABELS: Record<DrugInteraction["severity"], string> = {
  contraindicated: "禁忌",
  caution: "注意",
};

const RENAL_LABELS: Record<"egfr" | "ccr", string> = { egfr: "eGFR", ccr: "CCr" };

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

interface Partner {
  identity: DrugIdentity;
  name: string;
  /** どこにある薬か(「RP2」「投与中」「持参薬」)。 */
  where: string;
}

/**
 * 1 つの薬剤行に対する相互作用の警告。相手はフォームの別の行と投与中の薬。
 * 同じ規則・同じ相手は 1 回だけ出す。
 */
function interactionWarnings(
  self: DrugIdentity,
  partners: Partner[],
  interactions: DrugInteraction[],
): MedicationWarning[] {
  const warnings: MedicationWarning[] = [];
  const seen = new Set<string>();

  for (const rule of interactions) {
    const selfIsA = ruleCodeMatches(self, rule.code_a);
    const selfIsB = ruleCodeMatches(self, rule.code_b);
    if (!selfIsA && !selfIsB) continue;

    for (const partner of partners) {
      const hit =
        (selfIsA && ruleCodeMatches(partner.identity, rule.code_b)) ||
        (selfIsB && ruleCodeMatches(partner.identity, rule.code_a));
      if (!hit) continue;
      const dedupe = `${rule.id}:${partner.identity.key}:${partner.where}`;
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
export type ConditionResult =
  | { status: "met"; label: string }
  | { status: "unknown"; label: string; missing: string };

export function evaluateConditions(rule: DrugDoseRule, patient: PatientFactors): ConditionResult | null {
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

/** 上限を比べる薬剤行。 */
interface DosedLine {
  identity: DrugIdentity;
  line: CheckedLine;
}

/**
 * 行の量を規則の単位に直す。配合剤に成分・ATC 分類の規則が当たるときは、当たった成分の含量(成分マスタ)で
 * 数える。それ以外は製剤としての換算(投与量換算マスタ)。直せなければ null。
 */
function ruleAmount(
  rule: DrugDoseRule,
  drug: DosedLine,
  value: number,
  conversions: MedicineDoseConversionMap | undefined,
): number | null {
  const unit = rule.dose_unit ?? "";
  const medicineCode = drug.line.medicine!.medicine_code;
  const doseUnit = drug.line.dose!.unit;
  const hit = ruleComponents(drug.identity, rule.code);
  if (drug.identity.components.length <= 1 || hit.length === 0) {
    return convertDose(value, doseUnit, medicineCode, unit, conversions);
  }
  if (hit.some((c) => c.amount === null || c.amountUnit !== unit)) return null;
  // 配合剤は薬価算定単位(錠)で入力する。換算行があるときだけ製剤数に直す。
  const packUnit = conversions?.packUnits.get(medicineCode);
  const packs = packUnit ? convertDose(value, doseUnit, medicineCode, packUnit, conversions) : value;
  return packs === null ? null : packs * hit.reduce((sum, c) => sum + c.amount!, 0);
}

/**
 * 1 日量を足し合わせる相手か。成分で書いた規則はその成分を含む行すべて、群(薬効分類・ATC 分類)で
 * 書いた規則は成分ごとの上限なので同じ成分の行だけ。
 */
function sharesDailyLimit(rule: DrugDoseRule, self: DosedLine, other: DosedLine): boolean {
  if (!ruleCodeMatches(other.identity, rule.code)) return false;
  if (rule.dosage_form && rule.dosage_form !== other.line.medicine!.dosage_form) return false;
  switch (ruleCodeKind(rule.code)) {
    case "ingredient":
      return true;
    case "atc": {
      const ids = ruleComponents(self.identity, rule.code).map((c) => c.id);
      return ruleComponents(other.identity, rule.code).some((c) => ids.includes(c.id));
    }
    case "yj":
      return other.identity.key === self.identity.key;
  }
}

/**
 * 規則の上限と行の投与量を比べる。比べられる上限が無ければ空。1 日量は、同じ成分を含むフォームの
 * 他の行(`others`)と足し合わせて比べる。1 回量は行ごと。
 */
function limitWarnings(
  rule: DrugDoseRule,
  condition: string,
  self: DosedLine,
  others: DosedLine[],
  patient: PatientFactors,
  conversions: MedicineDoseConversionMap | undefined,
): MedicationWarning[] {
  const dose = self.line.dose;
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

  const isCombination = self.identity.components.length > 1;
  const warnings: MedicationWarning[] = [];
  for (const limit of limits) {
    const own = ruleAmount(rule, self, limit.amount!, conversions);
    if (own === null) {
      warnings.push({
        kind: "dose",
        text: `${dose.unit} を ${unit} に換算できず、${limit.kind}の上限 ${formatNumber(limit.max)}${unit}${perKgSuffix} を確認できません`,
        high: false,
        detail: isCombination
          ? "成分マスタに含量が無い配合剤です。"
          : "投与量換算マスタに換算行を登録すると確認できます。",
      });
      continue;
    }
    // 換算できない行は足さない(その行には「確認できません」が出る)。
    const added =
      limit.kind === "1日量"
        ? others
            .filter((other) => other.line.dose?.daily != null && sharesDailyLimit(rule, self, other))
            .map((other) => ruleAmount(rule, other, other.line.dose!.daily!, conversions))
            .filter((amount): amount is number => amount !== null)
        : [];
    const amount = added.reduce((sum, value) => sum + value, own);
    const weight = rule.per_kg ? patient.weight!.value : 1;
    const max = limit.max * weight;
    // 換算の丸めで上限ちょうどが超過に見えないよう、わずかな誤差は許す。
    if (amount <= max * 1.0001) continue;

    const basis = rule.per_kg
      ? `${formatNumber(limit.max)}${unit}/kg × ${formatNumber(weight)}kg（${patient.weight!.date}）`
      : "";
    const total = added.length > 0 ? `（${added.length + 1} 剤の合計）` : "";
    warnings.push({
      kind: "dose",
      text: `上限超過${prefix}: ${limit.kind} ${formatNumber(amount)}${unit}${total} > ${formatNumber(max)}${unit}`,
      high: true,
      detail: [basis, rule.message].filter(Boolean).join("\n") || undefined,
    });
  }
  return warnings;
}

/** 投与日数の上限と行の日数を比べる。 */
function daysWarnings(rule: DrugDoseRule, condition: string, days: number | null | undefined): MedicationWarning[] {
  if (rule.max_days === null || days == null || days <= rule.max_days) return [];
  const prefix = condition ? ` ${condition}` : "";
  return [
    {
      kind: "days-limit",
      text: `投与日数の上限超過${prefix}: ${days}日 > ${rule.max_days}日`,
      high: true,
      detail: rule.message ?? undefined,
    },
  ];
}

/** 累積の上限だけを持つ規則。1 回のオーダーでは比べるものが無いので、処方・注射のフォームには出さない。 */
export function isCumulativeOnlyRule(rule: DrugDoseRule): boolean {
  return (
    rule.max_cumulative_dose !== null &&
    rule.max_single_dose === null &&
    rule.max_daily_dose === null &&
    rule.max_days === null
  );
}

function doseRuleWarnings(
  self: DosedLine,
  others: DosedLine[],
  doseRules: DrugDoseRule[],
  patient: PatientFactors,
  conversions: MedicineDoseConversionMap | undefined,
): MedicationWarning[] {
  const { line } = self;
  const medicine = line.medicine!;
  const warnings: MedicationWarning[] = [];

  for (const rule of doseRules) {
    if (!ruleCodeMatches(self.identity, rule.code)) continue;
    if (rule.dosage_form && rule.dosage_form !== medicine.dosage_form) continue;
    if (isCumulativeOnlyRule(rule)) continue;

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

    const hasDoseLimit = rule.max_daily_dose !== null || rule.max_single_dose !== null;
    if (hasDoseLimit) {
      warnings.push(...limitWarnings(rule, condition.label, self, others, patient, conversions));
    }
    if (rule.max_days !== null) {
      warnings.push(...daysWarnings(rule, condition.label, line.days));
    }
    if (!hasDoseLimit && rule.max_days === null) {
      warnings.push({
        kind: "dose",
        text: `${SEVERITY_LABELS[rule.severity]} ${condition.label}: ${rule.message ?? ""}`,
        high: rule.severity === "contraindicated",
      });
    }
  }
  return warnings;
}

/** 病名との禁忌・注意。同じ規則は当たった病名ごとに 1 回。 */
function diseaseWarnings(
  self: DrugIdentity,
  diagnoses: PatientDiagnosis[],
  diseaseRules: DrugDiseaseRule[],
): MedicationWarning[] {
  const warnings: MedicationWarning[] = [];
  for (const rule of diseaseRules) {
    if (!ruleCodeMatches(self, rule.code)) continue;
    for (const diagnosis of diagnoses) {
      if (!diagnosis.code.startsWith(rule.disease_code)) continue;
      warnings.push({
        kind: "disease",
        text: `病名${SEVERITY_LABELS[rule.severity]}: ${diagnosis.name}`,
        high: rule.severity === "contraindicated",
        detail: [`${rule.name} × ${rule.disease_name}`, rule.note].filter(Boolean).join("\n"),
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
  diseaseRules?: DrugDiseaseRule[];
  diagnoses?: PatientDiagnosis[];
  patient: PatientFactors;
  conversions: MedicineDoseConversionMap | undefined;
  excludeOrderId?: string;
  excludeBroughtIds?: string[];
  /** 成分マスタ。渡さなければ成分の ID で書いた規則は当たらない。 */
  ingredients?: IngredientIndex;
}): MedicationWarning[][][] {
  const {
    rps,
    active,
    interactions,
    doseRules,
    diseaseRules = [],
    diagnoses = [],
    patient,
    conversions,
    excludeOrderId,
    excludeBroughtIds = [],
    ingredients = EMPTY_INGREDIENT_INDEX,
  } = args;

  const formLines = rps.flatMap((rp, rpIndex) =>
    rp.medicines.flatMap((line, medIndex) => {
      const identity = medicineIdentity(line.medicine, ingredients);
      return identity && line.medicine
        ? [{ rpIndex, medIndex, identity, line, name: line.medicine.name }]
        : [];
    }),
  );
  const ongoing: Partner[] = active
    .filter((a) => (a.brought ? !excludeBroughtIds.includes(a.orderId) : a.orderId !== excludeOrderId))
    .map((a) => ({ identity: activeIdentity(a, ingredients), name: a.name, where: a.brought ? "持参薬" : "投与中" }));

  return rps.map((rp, rpIndex) =>
    rp.medicines.map((line, medIndex) => {
      const self = medicineIdentity(line.medicine, ingredients);
      if (!self || !line.medicine) return [];

      const otherLines = formLines.filter((l) => l.rpIndex !== rpIndex || l.medIndex !== medIndex);
      const partners: Partner[] = [
        ...otherLines.map((l) => ({ identity: l.identity, name: l.name, where: `RP${l.rpIndex + 1}` })),
        ...ongoing,
      ];
      return [
        ...interactionWarnings(self, partners, interactions),
        ...doseRuleWarnings({ identity: self, line }, otherLines, doseRules, patient, conversions),
        ...diseaseWarnings(self, diagnoses, diseaseRules),
      ];
    }),
  );
}
