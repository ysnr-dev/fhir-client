import type {
  RegimenDetail,
  RegimenDoseBasis,
  RegimenDrugRole,
  RegimenEmeticRisk,
  RegimenLabCategory,
  RegimenPayload,
  RegimenPurpose,
  RegimenSetting,
  RegimenStatus,
  RegimenStepUsageType,
} from "../api/masterClient";
import type { CodeOption } from "./injectionHelpers";

// 化学療法レジメンマスタの選択肢と、画面の入力値(draft)と API の相互変換。
// React に依存しない。設計は docs/chemo-regimen-design.md。

export const REGIMEN_PURPOSE_OPTIONS: { code: RegimenPurpose; display: string }[] = [
  { code: "neoadjuvant", display: "術前補助" },
  { code: "adjuvant", display: "術後補助" },
  { code: "curative", display: "根治" },
  { code: "palliative", display: "緩和" },
  { code: "other", display: "その他" },
];

export const REGIMEN_SETTING_OPTIONS: { code: RegimenSetting; display: string }[] = [
  { code: "outpatient", display: "外来" },
  { code: "inpatient", display: "入院" },
  { code: "both", display: "外来・入院" },
];

export const REGIMEN_EMETIC_RISK_OPTIONS: { code: RegimenEmeticRisk; display: string }[] = [
  { code: "high", display: "高度" },
  { code: "moderate", display: "中等度" },
  { code: "low", display: "軽度" },
  { code: "minimal", display: "最小度" },
];

export const REGIMEN_STATUS_OPTIONS: { code: RegimenStatus; display: string }[] = [
  { code: "draft", display: "下書き" },
  { code: "approved", display: "承認済" },
  { code: "retired", display: "廃止" },
];

export const REGIMEN_STEP_USAGE_TYPE_OPTIONS: { code: RegimenStepUsageType; display: string }[] = [
  { code: "drip", display: "点滴" },
  { code: "one-shot", display: "ワンショット" },
  { code: "oral", display: "内服" },
];

export const REGIMEN_DRUG_ROLE_OPTIONS: { code: RegimenDrugRole; display: string }[] = [
  { code: "anticancer", display: "抗がん剤" },
  { code: "fluid", display: "補液・溶解液" },
  { code: "antiemetic", display: "制吐剤" },
  { code: "premedication", display: "前投薬" },
  { code: "supportive", display: "支持療法" },
  { code: "other", display: "その他" },
];

export const REGIMEN_DOSE_BASIS_OPTIONS: { code: RegimenDoseBasis; display: string }[] = [
  { code: "bsa", display: "体表面積(/m²)" },
  { code: "weight", display: "体重(/kg)" },
  { code: "auc", display: "AUC" },
  { code: "fixed", display: "固定量" },
  { code: "unit", display: "製剤単位" },
];

export const REGIMEN_LAB_CATEGORY_OPTIONS: { code: RegimenLabCategory; display: string }[] = [
  { code: "renal", display: "腎機能" },
  { code: "hepatic", display: "肝機能" },
  { code: "blood", display: "血液検査" },
  { code: "other", display: "その他" },
];

export const CTCAE_GRADE_OPTIONS = ["1", "2", "3", "4", "5"];

export function displayOfOption(options: readonly CodeOption[], code: string | null | undefined): string {
  if (!code) return "";
  return options.find((o) => o.code === code)?.display ?? code;
}

/** 算出基準ごとの投与量の単位表示(基準値・上限値の後ろに添える)。 */
export function doseUnitSuffix(basis: RegimenDoseBasis, doseUnit: string): string {
  switch (basis) {
    case "bsa":
      return `${doseUnit || "mg"}/m²`;
    case "weight":
      return `${doseUnit || "mg"}/kg`;
    case "auc":
      return doseUnit || "mg·min/mL";
    case "fixed":
      return `${doseUnit || "mg"}/body`;
    case "unit":
      return doseUnit;
    default:
      return doseUnit;
  }
}

/** 「1, 8, 15」→ [1, 8, 15]。数字以外はそのまま NaN として残し、検証で弾く。 */
export function parseDays(text: string): number[] {
  return text
    .split(/[,、\s]+/)
    .filter((t) => t !== "")
    .map((t) => Number(t));
}

export function formatDays(days: number[]): string {
  return days.join(", ");
}

// ---- 画面の入力値 ----

export interface RegimenDrugDraft {
  key: number;
  drugRole: RegimenDrugRole;
  /** 薬剤マスタから選んだ薬剤。名称・単位は表示用。 */
  medicine: { code: string; name: string; unitName: string } | null;
  doseBasis: RegimenDoseBasis;
  doseValue: string;
  doseUnit: string;
  doseMax: string;
  note: string;
}

export interface RegimenStepDraft {
  key: number;
  name: string;
  /** 投与日のカンマ区切り文字列。保存時に parseDays で配列にする。 */
  daysText: string;
  usageType: RegimenStepUsageType;
  routeCode: string;
  methodCode: string;
  lineCode: string;
  infusionMinutes: string;
  rate: string;
  deviceNote: string;
  usage: { code: string; name: string } | null;
  doseDays: string;
  note: string;
  drugs: RegimenDrugDraft[];
}

export interface RegimenIndicationDraft {
  key: number;
  managementNumber: string;
  name: string;
  icd10: string;
}

export interface RegimenLabCriterionDraft {
  key: number;
  category: RegimenLabCategory;
  analyteCode: string;
  itemName: string;
  unit: string;
  lowerLimit: string;
  upperLimit: string;
  note: string;
}

export interface RegimenAdverseEventDraft {
  key: number;
  term: string;
  grade: string;
  note: string;
}

export interface RegimenDraft {
  regimenCode: string;
  name: string;
  shortName: string;
  nameKana: string;
  departmentCode: string;
  departmentName: string;
  purpose: RegimenPurpose | "";
  setting: RegimenSetting | "";
  treatmentDays: string;
  restDays: string;
  plannedCycles: string;
  emeticRisk: RegimenEmeticRisk | "";
  status: RegimenStatus;
  approvedOn: string;
  approvedBy: string;
  indicationNote: string;
  discontinuationCriteria: string;
  doseReductionCriteria: string;
  referencesNote: string;
  validFrom: string;
  validTo: string;
  displayOrder: string;
  note: string;
  indications: RegimenIndicationDraft[];
  steps: RegimenStepDraft[];
  labCriteria: RegimenLabCriterionDraft[];
  adverseEvents: RegimenAdverseEventDraft[];
}

let nextKey = 1;
/** 行の React key。保存済みの id とは無関係で、画面を開いている間だけ一意。 */
export function newDraftKey(): number {
  return nextKey++;
}

export function emptyRegimenDraft(): RegimenDraft {
  return {
    regimenCode: "",
    name: "",
    shortName: "",
    nameKana: "",
    departmentCode: "",
    departmentName: "",
    purpose: "",
    setting: "",
    treatmentDays: "",
    restDays: "",
    plannedCycles: "",
    emeticRisk: "",
    status: "draft",
    approvedOn: "",
    approvedBy: "",
    indicationNote: "",
    discontinuationCriteria: "",
    doseReductionCriteria: "",
    referencesNote: "",
    validFrom: "",
    validTo: "",
    displayOrder: "",
    note: "",
    indications: [],
    steps: [],
    labCriteria: [],
    adverseEvents: [],
  };
}

export function emptyStepDraft(usageType: RegimenStepUsageType = "drip"): RegimenStepDraft {
  return {
    key: newDraftKey(),
    name: "",
    daysText: "1",
    usageType,
    routeCode: usageType === "oral" ? "" : "IV",
    methodCode: "",
    lineCode: "",
    infusionMinutes: "",
    rate: "",
    deviceNote: "",
    usage: null,
    doseDays: "",
    note: "",
    drugs: [],
  };
}

export function emptyDrugDraft(): RegimenDrugDraft {
  return {
    key: newDraftKey(),
    drugRole: "anticancer",
    medicine: null,
    doseBasis: "bsa",
    doseValue: "",
    doseUnit: "mg",
    doseMax: "",
    note: "",
  };
}

export function emptyLabCriterionDraft(): RegimenLabCriterionDraft {
  return {
    key: newDraftKey(),
    category: "blood",
    analyteCode: "",
    itemName: "",
    unit: "",
    lowerLimit: "",
    upperLimit: "",
    note: "",
  };
}

export function emptyAdverseEventDraft(): RegimenAdverseEventDraft {
  return { key: newDraftKey(), term: "", grade: "", note: "" };
}

function str(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function draftFromRegimen(detail: RegimenDetail): RegimenDraft {
  return {
    regimenCode: detail.regimen_code,
    name: detail.name,
    shortName: str(detail.short_name),
    nameKana: str(detail.name_kana),
    departmentCode: str(detail.department_code),
    departmentName: str(detail.department_name),
    purpose: detail.purpose ?? "",
    setting: detail.setting ?? "",
    treatmentDays: str(detail.treatment_days),
    restDays: str(detail.rest_days),
    plannedCycles: str(detail.planned_cycles),
    emeticRisk: detail.emetic_risk ?? "",
    status: detail.status,
    approvedOn: str(detail.approved_on),
    approvedBy: str(detail.approved_by),
    indicationNote: str(detail.indication_note),
    discontinuationCriteria: str(detail.discontinuation_criteria),
    doseReductionCriteria: str(detail.dose_reduction_criteria),
    referencesNote: str(detail.references_note),
    validFrom: str(detail.valid_from),
    validTo: str(detail.valid_to),
    displayOrder: str(detail.display_order),
    note: str(detail.note),
    indications: detail.indications.map((i) => ({
      key: newDraftKey(),
      managementNumber: i.management_number,
      name: i.name,
      icd10: str(i.icd10),
    })),
    steps: detail.steps.map((s) => ({
      key: newDraftKey(),
      name: str(s.name),
      daysText: formatDays(s.days),
      usageType: s.usage_type,
      routeCode: str(s.route_code),
      methodCode: str(s.method_code),
      lineCode: str(s.line_code),
      infusionMinutes: str(s.infusion_minutes),
      rate: str(s.rate),
      deviceNote: str(s.device_note),
      usage: s.usage_code ? { code: s.usage_code, name: s.usage?.usage_name ?? "" } : null,
      doseDays: str(s.dose_days),
      note: str(s.note),
      drugs: s.drugs.map((d) => ({
        key: newDraftKey(),
        drugRole: d.drug_role,
        medicine: {
          code: d.medicine_code,
          name: d.resolved_name ?? "(マスタ未取込のコード)",
          unitName: d.resolved_unit_name ?? "",
        },
        doseBasis: d.dose_basis,
        doseValue: str(d.dose_value),
        doseUnit: str(d.dose_unit),
        doseMax: str(d.dose_max),
        note: str(d.note),
      })),
    })),
    labCriteria: detail.lab_criteria.map((c) => ({
      key: newDraftKey(),
      category: c.category,
      analyteCode: str(c.analyte_code),
      itemName: c.item_name,
      unit: str(c.unit),
      lowerLimit: str(c.lower_limit),
      upperLimit: str(c.upper_limit),
      note: str(c.note),
    })),
    adverseEvents: detail.adverse_events.map((a) => ({
      key: newDraftKey(),
      term: a.term,
      grade: str(a.grade),
      note: str(a.note),
    })),
  };
}

function numOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function textOrNull(text: string): string | null {
  return text.trim() === "" ? null : text;
}

export function payloadFromDraft(draft: RegimenDraft): RegimenPayload {
  return {
    regimen_code: draft.regimenCode.trim() || undefined,
    name: draft.name.trim(),
    short_name: textOrNull(draft.shortName),
    name_kana: textOrNull(draft.nameKana),
    department_code: textOrNull(draft.departmentCode),
    department_name: textOrNull(draft.departmentName),
    purpose: draft.purpose || null,
    setting: draft.setting || null,
    treatment_days: numOrNull(draft.treatmentDays),
    rest_days: numOrNull(draft.restDays),
    planned_cycles: numOrNull(draft.plannedCycles),
    emetic_risk: draft.emeticRisk || null,
    status: draft.status,
    approved_on: textOrNull(draft.approvedOn),
    approved_by: textOrNull(draft.approvedBy),
    indication_note: textOrNull(draft.indicationNote),
    discontinuation_criteria: textOrNull(draft.discontinuationCriteria),
    dose_reduction_criteria: textOrNull(draft.doseReductionCriteria),
    references_note: textOrNull(draft.referencesNote),
    valid_from: textOrNull(draft.validFrom),
    valid_to: textOrNull(draft.validTo),
    display_order: numOrNull(draft.displayOrder),
    note: textOrNull(draft.note),
    indications: draft.indications.map((i) => ({
      management_number: i.managementNumber,
      name: i.name,
      icd10: textOrNull(i.icd10),
    })),
    steps: draft.steps.map((s) => {
      const oral = s.usageType === "oral";
      return {
        name: textOrNull(s.name),
        days: parseDays(s.daysText),
        usage_type: s.usageType,
        route_code: oral ? null : textOrNull(s.routeCode),
        method_code: oral ? null : textOrNull(s.methodCode),
        line_code: oral ? null : textOrNull(s.lineCode),
        infusion_minutes: s.usageType === "drip" ? numOrNull(s.infusionMinutes) : null,
        rate: s.usageType === "drip" ? numOrNull(s.rate) : null,
        device_note: oral ? null : textOrNull(s.deviceNote),
        usage_code: oral ? (s.usage?.code ?? null) : null,
        dose_days: oral ? numOrNull(s.doseDays) : null,
        note: textOrNull(s.note),
        drugs: s.drugs.map((d) => ({
          drug_role: d.drugRole,
          medicine_code: d.medicine?.code ?? "",
          dose_basis: d.doseBasis,
          dose_value: numOrNull(d.doseValue),
          dose_unit: textOrNull(d.doseUnit),
          dose_max: numOrNull(d.doseMax),
          note: textOrNull(d.note),
        })),
      };
    }),
    lab_criteria: draft.labCriteria.map((c) => ({
      category: c.category,
      analyte_code: textOrNull(c.analyteCode),
      item_name: c.itemName.trim(),
      unit: textOrNull(c.unit),
      lower_limit: numOrNull(c.lowerLimit),
      upper_limit: numOrNull(c.upperLimit),
      note: textOrNull(c.note),
    })),
    adverse_events: draft.adverseEvents.map((a) => ({
      term: a.term.trim(),
      grade: numOrNull(a.grade),
      note: textOrNull(a.note),
    })),
  };
}

/** 1 クールの日数(投与期間 + 休薬期間)。どちらも空なら 0。 */
export function cycleDaysOf(draft: Pick<RegimenDraft, "treatmentDays" | "restDays">): number {
  return (numOrNull(draft.treatmentDays) ?? 0) + (numOrNull(draft.restDays) ?? 0);
}

/**
 * 保存前の検証。サーバーの検証と二重になるものは持たず、画面でしか分からないもの
 * (薬剤未選択・投与日の書式・クール外の投与日)だけを見る。問題なければ null。
 */
export function validateRegimenDraft(draft: RegimenDraft): string | null {
  if (!draft.name.trim()) return "レジメン名を入力してください";
  const cycle = cycleDaysOf(draft);
  for (const [index, step] of draft.steps.entries()) {
    const label = `ステップ ${index + 1}${step.name ? `(${step.name})` : ""}`;
    const days = parseDays(step.daysText);
    if (days.length === 0) return `${label} の投与日を入力してください`;
    if (days.some((d) => !Number.isInteger(d) || d < 1)) {
      return `${label} の投与日は 1 以上の整数をカンマ区切りで入力してください`;
    }
    if (new Set(days).size !== days.length) return `${label} の投与日に同じ日が重複しています`;
    if (cycle > 0 && days.some((d) => d > cycle)) {
      return `${label} の投与日が 1 クール(${cycle} 日)を超えています`;
    }
    if (step.usageType === "oral" && !step.usage) return `${label} の用法を選択してください`;
    if (step.drugs.length === 0) return `${label} に薬剤がありません`;
    for (const [drugIndex, drug] of step.drugs.entries()) {
      if (!drug.medicine) return `${label} の薬剤 ${drugIndex + 1} を選択してください`;
      const value = numOrNull(drug.doseValue);
      if (drug.doseValue.trim() !== "" && (value === null || value <= 0)) {
        return `${label} の ${drug.medicine.name} の基準値は正の数で入力してください`;
      }
      const max = numOrNull(drug.doseMax);
      if (drug.doseMax.trim() !== "" && (max === null || max <= 0)) {
        return `${label} の ${drug.medicine.name} の上限値は正の数で入力してください`;
      }
      if (value !== null && max !== null && max < value) {
        return `${label} の ${drug.medicine.name} の上限値は基準値以上にしてください`;
      }
    }
  }
  for (const [index, c] of draft.labCriteria.entries()) {
    if (!c.itemName.trim()) return `検査基準 ${index + 1} の検査項目を入力してください`;
    const lower = numOrNull(c.lowerLimit);
    const upper = numOrNull(c.upperLimit);
    if (lower !== null && upper !== null && lower >= upper) {
      return `検査基準 ${index + 1}(${c.itemName})の上限は下限より大きくしてください`;
    }
  }
  for (const [index, a] of draft.adverseEvents.entries()) {
    if (!a.term.trim()) return `副作用 ${index + 1} の用語を入力してください`;
  }
  return null;
}

/** 投与時間(分)から総投与量(mL)に対する速度(mL/h)。どちらか無ければ空。 */
export function rateFromMinutes(totalMl: number, minutes: string): string {
  const m = Number(minutes);
  if (!totalMl || !m || !Number.isFinite(m) || m <= 0) return "";
  return String(Math.round((totalMl / (m / 60)) * 10) / 10);
}
