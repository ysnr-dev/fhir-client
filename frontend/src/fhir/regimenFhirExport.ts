import type {
  RegimenDetail,
  RegimenDrug,
  RegimenLabCriterion,
  RegimenStatus,
  RegimenStep,
} from "../api/masterClient";
import { downloadBlob } from "../lib/download";
import { DISEASE_KEY_NUMBER_SYSTEM, ICD10_SYSTEM } from "./conditionHelpers";
import { SSMIX2_DEPARTMENT_CODE_SYSTEM } from "./departmentCodes";
import {
  LINE_EXT_URL,
  LINE_OPTIONS,
  LINE_SYSTEM,
  METHOD_OPTIONS,
  METHOD_SYSTEM,
  ROUTE_OPTIONS,
  ROUTE_SYSTEM,
  USAGE_TYPE_EXT_URL,
  USAGE_TYPE_OPTIONS,
  USAGE_TYPE_SYSTEM,
} from "./injectionHelpers";
import {
  MEDICINE_CODE_SYSTEM,
  UNITS_OF_MEASURE_SYSTEM,
  USAGE_CATEGORY_SYSTEM,
  USAGE_CODE_SYSTEM,
  YJ_CODE_SYSTEM,
} from "./prescriptionHelpers";
import {
  REGIMEN_DOSE_BASIS_OPTIONS,
  REGIMEN_DRUG_ROLE_OPTIONS,
  REGIMEN_EMETIC_RISK_OPTIONS,
  REGIMEN_LAB_CATEGORY_OPTIONS,
  REGIMEN_PURPOSE_OPTIONS,
  doseBasisLabel,
  formatDays,
} from "./regimenHelpers";
import { REGIMEN_CODE_SYSTEM, REGIMEN_URI_PREFIX } from "./regimenOrderHelpers";
import { displayOf } from "./shared";

// レジメンマスタ 1 件を FHIR の定義リソースに写す(docs/chemo-regimen-design.md §8.30)。
// PlanDefinition(レジメン本体・クール・投与ステップ)と、薬剤ごとの ActivityDefinition
// (kind = MedicationRequest)を collection の Bundle にまとめる。React に依存しない。

const BASE = "http://fhir-client.local";
const ACTIVITY_DEFINITION_URL_PREFIX = `${BASE}/ActivityDefinition/`;

const PLAN_DEFINITION_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/plan-definition-type";
const USAGE_CONTEXT_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/usage-context-type";
const ACT_CODE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode";
// クールの中の投与日(HL7 の標準拡張)。子の "day" に相対日を 1 つずつ持つ。
const DAYS_OF_CYCLE_EXT_URL = "http://hl7.org/fhir/StructureDefinition/timing-daysOfCycle";

export const REGIMEN_PURPOSE_SYSTEM = `${BASE}/CodeSystem/regimen-purpose`;
export const REGIMEN_EMETIC_RISK_SYSTEM = `${BASE}/CodeSystem/regimen-emetic-risk`;
export const REGIMEN_DRUG_ROLE_SYSTEM = `${BASE}/CodeSystem/regimen-drug-role`;
export const REGIMEN_DOSE_BASIS_SYSTEM = `${BASE}/CodeSystem/regimen-dose-basis`;
export const REGIMEN_LAB_CATEGORY_SYSTEM = `${BASE}/CodeSystem/regimen-lab-category`;
/** JLAC11 の分析物(先頭 5 桁)。 */
export const JLAC11_ANALYTE_SYSTEM = `${BASE}/CodeSystem/jlac11-analyte`;

export const REGIMEN_EMETIC_RISK_EXT_URL = `${BASE}/StructureDefinition/regimen-emetic-risk`;
export const REGIMEN_LAB_CRITERION_EXT_URL = `${BASE}/StructureDefinition/regimen-lab-criterion`;
export const REGIMEN_ADVERSE_EVENT_EXT_URL = `${BASE}/StructureDefinition/regimen-adverse-event`;
export const REGIMEN_DISCONTINUATION_EXT_URL = `${BASE}/StructureDefinition/regimen-discontinuation-criteria`;
export const REGIMEN_DOSE_REDUCTION_EXT_URL = `${BASE}/StructureDefinition/regimen-dose-reduction-criteria`;

const STATUS_MAP: Record<RegimenStatus, fhir4.PlanDefinition["status"]> = {
  draft: "draft",
  approved: "active",
  retired: "retired",
};

/** UCUM にそのまま載る単位。それ以外(瓶・袋・単位など)は unit の文字だけを持つ。 */
const UCUM_UNITS = new Set(["mg", "g", "ug", "mL", "L"]);

/** FHIR の id に使えない文字を除く(id は英数字・ハイフン・ピリオドの 64 文字まで)。 */
function fhirId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9.-]/g, "-").slice(0, 64);
}

function coded(system: string, options: readonly { code: string; display: string }[], code: string): fhir4.Coding {
  return { system, code, display: displayOf(options, code) };
}

function quantity(value: number, unit: string | null | undefined): fhir4.Quantity {
  if (unit && UCUM_UNITS.has(unit)) return { value, unit, system: UNITS_OF_MEASURE_SYSTEM, code: unit };
  return { value, ...(unit ? { unit } : {}) };
}

function days(value: number): fhir4.Duration {
  return { value, unit: "日", system: UNITS_OF_MEASURE_SYSTEM, code: "d" };
}

/**
 * 基準値。体表面積・体重あたりは分母を単位に含め(mg/m2、mg/kg)、AUC は目標 AUC
 * (mg·min/mL)そのものを持つ。どの基準かは doseAndRate.type で読む。
 */
function basisQuantity(drug: RegimenDrug, value: number): fhir4.Quantity {
  const unit = drug.dose_unit ?? "";
  const ucum = UCUM_UNITS.has(unit);
  switch (drug.dose_basis) {
    case "bsa":
      return ucum
        ? { value, unit: `${unit}/m2`, system: UNITS_OF_MEASURE_SYSTEM, code: `${unit}/m2` }
        : { value, unit: `${unit}/m2` };
    case "weight":
      return ucum
        ? { value, unit: `${unit}/kg`, system: UNITS_OF_MEASURE_SYSTEM, code: `${unit}/kg` }
        : { value, unit: `${unit}/kg` };
    case "auc":
      return { value, unit: "mg.min/mL", system: UNITS_OF_MEASURE_SYSTEM, code: "mg.min/mL" };
    case "unit":
      return quantity(value, unit || drug.resolved_unit_name);
    default:
      return quantity(value, unit);
  }
}

function drugName(drug: RegimenDrug): string {
  return drug.resolved_name ?? drug.medicine_code;
}

function dosageText(step: RegimenStep, drug: RegimenDrug): string | undefined {
  const oral = step.usage_type === "oral";
  const parts = [
    oral ? "内服" : displayOf(USAGE_TYPE_OPTIONS, step.usage_type),
    oral ? (step.usage?.usage_name ?? "") : displayOf(ROUTE_OPTIONS, step.route_code),
    drug.dose_value !== null ? doseBasisLabel(drug.dose_basis, Number(drug.dose_value), drug.dose_unit ?? "") : "",
    oral && drug.dose_value !== null ? "(1 日量)" : "",
    !oral && step.infusion_minutes ? `${step.infusion_minutes}分` : "",
  ];
  return parts.filter(Boolean).join(" ") || undefined;
}

function buildDosage(step: RegimenStep, drug: RegimenDrug): fhir4.Dosage {
  const oral = step.usage_type === "oral";
  const dosage: fhir4.Dosage = { text: dosageText(step, drug) };

  const extension: fhir4.Extension[] = [];
  if (!oral) {
    extension.push({
      url: USAGE_TYPE_EXT_URL,
      valueCodeableConcept: { coding: [coded(USAGE_TYPE_SYSTEM, USAGE_TYPE_OPTIONS, step.usage_type)] },
    });
    if (step.line_code) {
      extension.push({
        url: LINE_EXT_URL,
        valueCodeableConcept: { coding: [coded(LINE_SYSTEM, LINE_OPTIONS, step.line_code)] },
      });
    }
  }
  if (extension.length) dosage.extension = extension;

  if (oral && step.usage) {
    dosage.timing = {
      code: {
        coding: [
          { system: USAGE_CODE_SYSTEM, code: step.usage.usage_code, display: step.usage.usage_name },
          ...(step.usage.basic_usage_category_code
            ? [
                {
                  system: USAGE_CATEGORY_SYSTEM,
                  code: step.usage.basic_usage_category_code,
                  display: step.usage.basic_usage_category ?? undefined,
                },
              ]
            : []),
        ],
        text: step.usage.usage_name,
      },
    };
  } else if (oral && step.usage_code) {
    dosage.timing = { code: { coding: [{ system: USAGE_CODE_SYSTEM, code: step.usage_code }] } };
  } else if (!oral && step.infusion_minutes) {
    dosage.timing = { repeat: { duration: step.infusion_minutes, durationUnit: "min" } };
  }

  if (!oral && step.route_code) {
    dosage.route = { coding: [coded(ROUTE_SYSTEM, ROUTE_OPTIONS, step.route_code)] };
  }
  if (!oral && step.method_code) {
    dosage.method = { coding: [coded(METHOD_SYSTEM, METHOD_OPTIONS, step.method_code)] };
  }
  if (!oral && step.device_note) {
    dosage.additionalInstruction = [{ text: step.device_note }];
  }

  const doseAndRate: fhir4.DosageDoseAndRate = {
    type: { coding: [coded(REGIMEN_DOSE_BASIS_SYSTEM, REGIMEN_DOSE_BASIS_OPTIONS, drug.dose_basis)] },
  };
  if (drug.dose_value !== null) {
    const basis = basisQuantity(drug, Number(drug.dose_value));
    // 内服の基準値は 1 日量。
    if (oral) doseAndRate.rateRatio = { numerator: basis, denominator: days(1) };
    else doseAndRate.doseQuantity = basis;
  }
  if (!oral && step.usage_type === "drip" && step.rate) {
    const rate = { value: Number(step.rate), unit: "mL/h", system: UNITS_OF_MEASURE_SYSTEM, code: "mL/h" };
    // doseAndRate の rate[x] は 1 つだけなので、量と速度は別の要素に分ける。
    dosage.doseAndRate = [doseAndRate, { rateQuantity: rate }];
  } else {
    dosage.doseAndRate = [doseAndRate];
  }

  // 上限値は体格から計算した量に当てる絶対量(内服は 1 日量)。
  if (drug.dose_max !== null) {
    const max = quantity(Number(drug.dose_max), drug.dose_unit);
    if (oral) dosage.maxDosePerPeriod = { numerator: max, denominator: days(1) };
    else dosage.maxDosePerAdministration = max;
  }

  return dosage;
}

function buildActivityDefinition(
  regimen: RegimenDetail,
  step: RegimenStep,
  drug: RegimenDrug,
  id: string,
): fhir4.ActivityDefinition {
  const name = drugName(drug);
  return {
    resourceType: "ActivityDefinition",
    id,
    url: `${ACTIVITY_DEFINITION_URL_PREFIX}${id}`,
    title: name,
    status: STATUS_MAP[regimen.status],
    date: regimen.updated_at,
    kind: "MedicationRequest",
    intent: "order",
    productCodeableConcept: {
      coding: [
        { system: MEDICINE_CODE_SYSTEM, code: drug.medicine_code, display: name },
        ...(drug.yj_code ? [{ system: YJ_CODE_SYSTEM, code: drug.yj_code, display: name }] : []),
      ],
      text: name,
    },
    dosage: [buildDosage(step, drug)],
  };
}

/** ステップの投与日(action に付ける HL7 の標準拡張。context は PlanDefinition.action)。 */
function daysOfCycleExtension(step: RegimenStep): fhir4.Extension | undefined {
  if (!step.days.length) return undefined;
  return {
    url: DAYS_OF_CYCLE_EXT_URL,
    extension: step.days.map((day) => ({ url: "day", valueInteger: day })),
  };
}

/** 内服は各投与日から dose_days 日ぶん続ける。 */
function stepTiming(step: RegimenStep): fhir4.Timing | undefined {
  if (step.usage_type !== "oral" || !step.dose_days) return undefined;
  return { repeat: { boundsDuration: days(step.dose_days) } };
}

function stepText(step: RegimenStep): string {
  const oral = step.usage_type === "oral";
  return [
    oral && step.dose_days
      ? step.days.map((day) => `Day ${day} から ${step.dose_days} 日分`).join("、")
      : `Day ${formatDays(step.days)}`,
    oral ? "内服" : displayOf(USAGE_TYPE_OPTIONS, step.usage_type),
    oral ? (step.usage?.usage_name ?? "") : displayOf(ROUTE_OPTIONS, step.route_code),
    !oral && step.infusion_minutes ? `${step.infusion_minutes}分` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildUseContext(regimen: RegimenDetail): fhir4.UsageContext[] {
  const context = (code: string, display: string): fhir4.Coding => ({
    system: USAGE_CONTEXT_TYPE_SYSTEM,
    code,
    display,
  });
  const result: fhir4.UsageContext[] = regimen.indications.map((indication) => ({
    code: context("focus", "Clinical Focus"),
    valueCodeableConcept: {
      coding: [
        { system: DISEASE_KEY_NUMBER_SYSTEM, code: indication.management_number, display: indication.name },
        ...(indication.icd10 ? [{ system: ICD10_SYSTEM, code: indication.icd10 }] : []),
      ],
      text: indication.name,
    },
  }));
  if (regimen.department_code || regimen.department_name) {
    result.push({
      code: context("user", "User Type"),
      valueCodeableConcept: {
        ...(regimen.department_code
          ? {
              coding: [
                {
                  system: SSMIX2_DEPARTMENT_CODE_SYSTEM,
                  code: regimen.department_code,
                  display: regimen.department_name ?? undefined,
                },
              ],
            }
          : {}),
        text: regimen.department_name ?? undefined,
      },
    });
  }
  const venue = (code: string, display: string): fhir4.UsageContext => ({
    code: context("venue", "Clinical Venue"),
    valueCodeableConcept: { coding: [{ system: ACT_CODE_SYSTEM, code, display }] },
  });
  if (regimen.setting === "outpatient" || regimen.setting === "both") result.push(venue("AMB", "ambulatory"));
  if (regimen.setting === "inpatient" || regimen.setting === "both") result.push(venue("IMP", "inpatient encounter"));
  return result;
}

function labCriterionExtension(criterion: RegimenLabCriterion): fhir4.Extension {
  const limit = (raw: string | null) => (raw !== null ? quantity(Number(raw), criterion.unit) : undefined);
  const low = limit(criterion.lower_limit);
  const high = limit(criterion.upper_limit);
  const parts: fhir4.Extension[] = [
    {
      url: "category",
      valueCoding: coded(REGIMEN_LAB_CATEGORY_SYSTEM, REGIMEN_LAB_CATEGORY_OPTIONS, criterion.category),
    },
    {
      url: "code",
      valueCodeableConcept: {
        ...(criterion.analyte_code
          ? { coding: [{ system: JLAC11_ANALYTE_SYSTEM, code: criterion.analyte_code, display: criterion.item_name }] }
          : {}),
        text: criterion.item_name,
      },
    },
  ];
  if (low || high) parts.push({ url: "range", valueRange: { ...(low ? { low } : {}), ...(high ? { high } : {}) } });
  if (criterion.note) parts.push({ url: "note", valueString: criterion.note });
  return { url: REGIMEN_LAB_CRITERION_EXT_URL, extension: parts };
}

function buildExtensions(regimen: RegimenDetail): fhir4.Extension[] {
  const result: fhir4.Extension[] = [];
  if (regimen.emetic_risk) {
    result.push({
      url: REGIMEN_EMETIC_RISK_EXT_URL,
      valueCoding: coded(REGIMEN_EMETIC_RISK_SYSTEM, REGIMEN_EMETIC_RISK_OPTIONS, regimen.emetic_risk),
    });
  }
  result.push(...regimen.lab_criteria.map(labCriterionExtension));
  if (regimen.dose_reduction_criteria) {
    result.push({ url: REGIMEN_DOSE_REDUCTION_EXT_URL, valueMarkdown: regimen.dose_reduction_criteria });
  }
  if (regimen.discontinuation_criteria) {
    result.push({ url: REGIMEN_DISCONTINUATION_EXT_URL, valueMarkdown: regimen.discontinuation_criteria });
  }
  for (const event of regimen.adverse_events) {
    result.push({
      url: REGIMEN_ADVERSE_EVENT_EXT_URL,
      extension: [
        { url: "term", valueString: event.term },
        ...(event.grade !== null ? [{ url: "grade", valueInteger: event.grade }] : []),
        ...(event.note ? [{ url: "note", valueString: event.note }] : []),
      ],
    });
  }
  return result;
}

/** 1 クールの長さと回数。投与期間は duration、1 クール(投与期間 + 休薬期間)は period。 */
function cycleTiming(regimen: RegimenDetail): fhir4.Timing | undefined {
  if (regimen.cycle_days <= 0) return undefined;
  return {
    repeat: {
      ...(regimen.planned_cycles ? { count: regimen.planned_cycles } : {}),
      ...(regimen.treatment_days ? { duration: regimen.treatment_days, durationUnit: "d" as const } : {}),
      frequency: 1,
      period: regimen.cycle_days,
      periodUnit: "d",
    },
  };
}

function buildRelatedArtifacts(regimen: RegimenDetail): fhir4.RelatedArtifact[] {
  const result: fhir4.RelatedArtifact[] = [];
  if (regimen.references_note) result.push({ type: "citation", citation: regimen.references_note });
  if (regimen.copied_from_code) {
    result.push({ type: "derived-from", resource: `${REGIMEN_URI_PREFIX}${regimen.copied_from_code}` });
  }
  return result;
}

/**
 * レジメン 1 件の Bundle(collection)。先頭が PlanDefinition、続いて薬剤ごとの
 * ActivityDefinition。PlanDefinition.url は適用のヘッダが instantiatesUri で指す URI と同じ。
 * 承認者と本体の備考は内部の申し送りなので載せない。
 */
export function buildRegimenFhirBundle(regimen: RegimenDetail): fhir4.Bundle {
  const planId = fhirId(`regimen-${regimen.regimen_code}`);
  const status = STATUS_MAP[regimen.status];
  const activities: fhir4.ActivityDefinition[] = [];

  const stepActions = regimen.steps.map((step, stepIndex): fhir4.PlanDefinitionAction => {
    const stepNumber = stepIndex + 1;
    const drugActions = step.drugs.map((drug, drugIndex): fhir4.PlanDefinitionAction => {
      const activity = buildActivityDefinition(
        regimen,
        step,
        drug,
        fhirId(`${planId}-s${stepNumber}-d${drugIndex + 1}`),
      );
      activities.push(activity);
      return {
        id: `step-${stepNumber}-drug-${drugIndex + 1}`,
        title: drugName(drug),
        ...(drug.note ? { description: drug.note } : {}),
        code: [{ coding: [coded(REGIMEN_DRUG_ROLE_SYSTEM, REGIMEN_DRUG_ROLE_OPTIONS, drug.drug_role)] }],
        definitionCanonical: activity.url,
      };
    });
    const timing = stepTiming(step);
    const daysOfCycle = daysOfCycleExtension(step);
    return {
      ...(daysOfCycle ? { extension: [daysOfCycle] } : {}),
      id: `step-${stepNumber}`,
      prefix: String(stepNumber),
      ...(step.name ? { title: step.name } : {}),
      ...(step.note ? { description: step.note } : {}),
      textEquivalent: stepText(step),
      ...(timing ? { timingTiming: timing } : {}),
      // 同じステップの薬剤は同じ容器に混ぜて投与する(注射の RP)。
      ...(drugActions.length
        ? { groupingBehavior: "logical-group" as const, selectionBehavior: "all" as const, action: drugActions }
        : {}),
    };
  });

  const timing = cycleTiming(regimen);
  const useContext = buildUseContext(regimen);
  const extension = buildExtensions(regimen);
  const relatedArtifact = buildRelatedArtifacts(regimen);

  const plan: fhir4.PlanDefinition = {
    resourceType: "PlanDefinition",
    id: planId,
    ...(extension.length ? { extension } : {}),
    url: `${REGIMEN_URI_PREFIX}${regimen.regimen_code}`,
    identifier: [{ system: REGIMEN_CODE_SYSTEM, value: regimen.regimen_code }],
    title: regimen.name,
    ...(regimen.short_name ? { subtitle: regimen.short_name } : {}),
    type: {
      coding: [{ system: PLAN_DEFINITION_TYPE_SYSTEM, code: "clinical-protocol", display: "Clinical Protocol" }],
    },
    status,
    date: regimen.updated_at,
    ...(useContext.length ? { useContext } : {}),
    ...(regimen.indication_note ? { usage: regimen.indication_note } : {}),
    ...(regimen.approved_on ? { approvalDate: regimen.approved_on } : {}),
    ...(regimen.valid_from || regimen.valid_to
      ? {
          effectivePeriod: {
            ...(regimen.valid_from ? { start: regimen.valid_from } : {}),
            ...(regimen.valid_to ? { end: regimen.valid_to } : {}),
          },
        }
      : {}),
    ...(relatedArtifact.length ? { relatedArtifact } : {}),
    ...(regimen.purpose
      ? {
          goal: [
            {
              description: {
                coding: [coded(REGIMEN_PURPOSE_SYSTEM, REGIMEN_PURPOSE_OPTIONS, regimen.purpose)],
                text: displayOf(REGIMEN_PURPOSE_OPTIONS, regimen.purpose),
              },
            },
          ],
        }
      : {}),
    action: [
      {
        id: "cycle",
        title: "1 クール",
        ...(timing ? { timingTiming: timing } : {}),
        ...(stepActions.length
          ? { groupingBehavior: "logical-group" as const, selectionBehavior: "all" as const, action: stepActions }
          : {}),
      },
    ],
  };

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: regimen.updated_at,
    entry: [
      { fullUrl: `${BASE}/PlanDefinition/${planId}`, resource: plan },
      ...activities.map((activity) => ({ fullUrl: activity.url, resource: activity })),
    ],
  };
}

export function downloadRegimenFhirBundle(regimen: RegimenDetail): void {
  const bundle = buildRegimenFhirBundle(regimen);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json" });
  downloadBlob(blob, `regimen-${regimen.regimen_code}.json`);
}
