import { nowFhirDateTime, today } from "../lib/dates";
import type {
  NursingPlanActivityType,
  NursingStandardPlan,
  NursingTerm,
  NursingTermItemType,
} from "../api/masterClient";
import { NURSING_PROBLEM_CATEGORY } from "./conditionHelpers";
import {
  NURSING_ACT_CODE_SYSTEM,
  NURSING_ACT_MANAGE_NO_SYSTEM,
  NURSING_OBSERVATION_CODE_SYSTEM,
  buildNursingOrderCloseEntry,
  buildNursingOrderRevokeEntry,
  emptyNursingOrderLine,
  nursingItemConcept,
  nursingOrderNeedsStop,
  planActivityOf,
  type NursingItemRef,
  type NursingOrderLineValues,
} from "./nursingOrderHelpers";
import { PATHWAY_MARKER_SYSTEM } from "./pathwayApplyHelpers";
import { codingBySystem, referenceIdOfType, transactionBundle, withVersionLock } from "./shared";
import { VITAL_PROBLEM_EXT_URL } from "./vitalHelpers";

// 看護計画(docs/nursing-care-plan-design.md)。看護問題 1 件を次の 4 種のリソースで持つ。
//
//   Condition(看護問題)  ← addresses ── CarePlan(看護計画: OP/TP/EP の行)── goal → Goal(目標)
//        ↑ reasonReference                ↑ 拡張 nursing-care-plan-activity(行の id)
//   ServiceRequest(計画の行から展開した看護指示)
//   Observation(評価)── focus → Goal / basedOn → CarePlan
//
// 看護問題は病名と同じ Condition にし、看護指示の対象(reasonReference)や目標の対象
// (Goal.addresses)に使う。category に problem-list-item を併記するのでレセコン送信の
// 保険病名からは外れ、病名・プロブレムの一覧からはローカルの nursing-problem で外す。

const LOCAL_CS = "http://fhir-client.local/CodeSystem";
const LOCAL_SD = "http://fhir-client.local/StructureDefinition";

export const NURSING_CARE_PLAN_CODE = "nursing";
export const NURSING_DIAGNOSIS_SYSTEM = `${LOCAL_CS}/nursing-diagnosis`;
export const NURSING_OUTCOME_SYSTEM = `${LOCAL_CS}/nursing-outcome`;
export const NURSING_INTERVENTION_SYSTEM = `${LOCAL_CS}/nursing-intervention`;
const FACTOR_SYSTEMS: Record<NursingFactorKind, string> = {
  defining_characteristic: `${LOCAL_CS}/nursing-defining-characteristic`,
  related_factor: `${LOCAL_CS}/nursing-related-factor`,
  risk_factor: `${LOCAL_CS}/nursing-risk-factor`,
};
const PRIORITY_EXT_URL = `${LOCAL_SD}/nursing-problem-priority`;
const ACTIVITY_TYPE_EXT_URL = `${LOCAL_SD}/nursing-plan-activity-type`;
const INTERVENTION_EXT_URL = `${LOCAL_SD}/nursing-intervention`;
/** 立案の入口(standard_plan / diagnosis)。看護計画タブはこれで区画を分ける。 */
const ENTRY_EXT_URL = `${LOCAL_SD}/nursing-care-plan-entry`;
const STANDARD_PLAN_URI_BASE = "http://fhir-client.local/master/nursing-standard-plans/";
export const NURSING_EVALUATION_SYSTEM = `${LOCAL_CS}/nursing-evaluation`;
const DECISION_SYSTEM = `${LOCAL_CS}/nursing-evaluation-decision`;
const GOAL_ACHIEVEMENT_SYSTEM = "http://terminology.hl7.org/CodeSystem/goal-achievement";
const CONDITION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/condition-category";
const CLINICAL_STATUS_SYSTEM = "http://terminology.hl7.org/CodeSystem/condition-clinical";
const VERIFICATION_STATUS_SYSTEM = "http://terminology.hl7.org/CodeSystem/condition-ver-status";

/** 看護計画・目標・評価に付ける category。上流は全 coding を索引するのでこれ 1 つで引ける。 */
export const NURSING_CARE_CATEGORY: fhir4.CodeableConcept = {
  coding: [{ system: PATHWAY_MARKER_SYSTEM, code: NURSING_CARE_PLAN_CODE, display: "看護計画" }],
};
export const NURSING_CARE_CATEGORY_TOKEN = `${PATHWAY_MARKER_SYSTEM}|${NURSING_CARE_PLAN_CODE}`;

// ---- 表示 ----

export type NursingFactorKind = "defining_characteristic" | "related_factor" | "risk_factor";

export const NURSING_ITEM_TYPE_LABELS: Record<NursingTermItemType, string> = {
  defining_characteristic: "診断指標",
  related_factor: "関連因子",
  risk_factor: "危険因子",
  indicator: "指標",
  activity: "行動",
};

export const NURSING_ACTIVITY_TYPE_LABELS: Record<NursingPlanActivityType, string> = {
  op: "OP（観察）",
  tp: "TP（ケア）",
  ep: "EP（教育）",
};

export const NURSING_ACTIVITY_TYPES: NursingPlanActivityType[] = ["op", "tp", "ep"];

export const NURSING_DIAGNOSIS_TYPE_LABELS = {
  problem: "問題焦点型",
  risk: "リスク型",
  health_promotion: "ヘルスプロモーション型",
} as const;

/** 目標の達成度(HL7 goal-achievement の一部)。 */
export type NursingAchievement = "achieved" | "improving" | "no-change" | "worsening" | "not-achieved";
export const NURSING_ACHIEVEMENT_OPTIONS: { code: NursingAchievement; display: string }[] = [
  { code: "achieved", display: "達成" },
  { code: "improving", display: "改善" },
  { code: "no-change", display: "変化なし" },
  { code: "worsening", display: "悪化" },
  { code: "not-achieved", display: "未達成" },
];

/** 問題単位の判定。resolve で看護問題を解決にし、計画を終える。 */
export type NursingDecision = "continue" | "revise" | "resolve";
export const NURSING_DECISION_OPTIONS: { code: NursingDecision; display: string }[] = [
  { code: "continue", display: "継続" },
  { code: "revise", display: "修正" },
  { code: "resolve", display: "解決" },
];

function displayOf<T extends string>(options: { code: T; display: string }[], code: string | undefined) {
  return options.find((o) => o.code === code)?.display ?? "";
}

// ---- 用語マスタの木 ----

export interface NursingTermTreeNode {
  term: NursingTerm;
  children: NursingTermTreeNode[];
}

/**
 * 領域 → 類 → 用語の木。query があれば名称・カナ・コードに含む用語と、その祖先だけを残す。
 * keepEmpty は配下の無い領域・類も出す(マスタの編集画面)。
 */
export function buildNursingTermTree(
  terms: NursingTerm[],
  query: string,
  { includeInactive = false, keepEmpty = false }: { includeInactive?: boolean; keepEmpty?: boolean } = {},
): NursingTermTreeNode[] {
  const byParent = new Map<string, NursingTerm[]>();
  for (const term of terms) {
    if (!includeInactive && !term.active) continue;
    const key = term.level === "domain" ? "" : (term.parent_code ?? "");
    byParent.set(key, [...(byParent.get(key) ?? []), term]);
  }
  const matches = (term: NursingTerm) =>
    !query || [term.name, term.name_kana ?? "", term.code].some((s) => s.includes(query));
  const childLevel = { domain: "class", class: "term", term: null } as const;
  const nodes = (parent: string, level: NursingTerm["level"]): NursingTermTreeNode[] =>
    (byParent.get(parent) ?? [])
      .filter((t) => t.level === level)
      .map((term) => {
        const next = childLevel[level];
        return { term, children: next ? nodes(term.code, next) : [] };
      })
      .filter((node) =>
        level === "term" ? matches(node.term) : node.children.length > 0 || (keepEmpty && !query),
      );
  return nodes("", "domain");
}

// ---- フォームの値 ----

export interface NursingFactorValues {
  kind: NursingFactorKind;
  code: string;
  name: string;
}

export interface NursingGoalValues {
  /** 保存済みの Goal の id。新しい目標は空。 */
  goalId: string;
  text: string;
  outcomeCode: string;
  outcomeName: string;
  /** 評価予定日。 */
  dueDate: string;
}

export interface NursingActivityValues {
  /** CarePlan.activity.id。展開した指示はこの id で行を指す。 */
  id: string;
  /** OP/TP/EP の区分。看護診断の入口で看護介入(NIC)の行動として書いた行は null(介入の下にまとめる)。 */
  type: NursingPlanActivityType | null;
  text: string;
  interventionCode: string;
  interventionName: string;
  item: NursingItemRef;
  /** 中止した行(detail.status = stopped)。 */
  stopped: boolean;
}

export interface NursingProblemFormValues {
  /** 立案の入口。 */
  entry: NursingProblemEntry;
  /** 看護診断マスタの用語。自由記載は null。 */
  diagnosis: { code: string; name: string } | null;
  /** 看護問題の名称。マスタから選んだときは用語名で埋める。 */
  name: string;
  factors: NursingFactorValues[];
  goals: NursingGoalValues[];
  activities: NursingActivityValues[];
  /** 立案日。 */
  onsetDate: string;
  standardPlanCode: string;
}

/** 立案の入口。standard_plan = 標準看護計画 / diagnosis = 看護診断(看護成果・看護介入で書く)。 */
export type NursingProblemEntry = "standard_plan" | "diagnosis";

/**
 * 計画の入口。保存した入口(拡張 nursing-care-plan-entry)を使い、無ければ中身から決める
 * (看護介入の行があれば看護診断、OP/TP/EP の行か標準看護計画があれば標準看護計画)。
 */
export function nursingCarePlanEntryOf(carePlan: fhir4.CarePlan): NursingProblemEntry {
  const saved = carePlan.extension?.find((e) => e.url === ENTRY_EXT_URL)?.valueCode;
  if (saved === "standard_plan" || saved === "diagnosis") return saved;
  const activities = nursingPlanActivities(carePlan);
  if (activities.some((a) => a.type === null)) return "diagnosis";
  if (activities.length > 0 || standardPlanCodeOf(carePlan)) return "standard_plan";
  return "diagnosis";
}

export function emptyNursingGoal(): NursingGoalValues {
  return { goalId: "", text: "", outcomeCode: "", outcomeName: "", dueDate: "" };
}

export function emptyNursingActivity(
  type: NursingPlanActivityType | null,
  intervention?: { code: string; name: string },
): NursingActivityValues {
  return {
    id: crypto.randomUUID(),
    type,
    text: "",
    interventionCode: intervention?.code ?? "",
    interventionName: intervention?.name ?? "",
    item: null,
    stopped: false,
  };
}

/**
 * 看護介入(NIC)を足す。マスタの行動を 1 行ずつ介入の下の行にする(行動が無ければ空の行を 1 つ)。
 * 要らない行は画面で消す。同じ介入が既にあれば足さない。
 */
export function addIntervention(values: NursingProblemFormValues, term: NursingTerm): NursingProblemFormValues {
  if (values.activities.some((a) => a.type === null && a.interventionCode === term.code)) return values;
  const intervention = { code: term.code, name: term.name };
  const actions = term.items.filter((i) => i.item_type === "activity");
  const rows = actions.length
    ? actions.map((action) => ({ ...emptyNursingActivity(null, intervention), text: action.name }))
    : [emptyNursingActivity(null, intervention)];
  return { ...values, activities: [...values.activities, ...rows] };
}

/** 看護介入ごとの行(看護診断の入口)。並びは最初に出てきた順。 */
export function interventionGroups(
  activities: NursingActivityValues[],
): { code: string; name: string; rows: NursingActivityValues[] }[] {
  const groups = new Map<string, { code: string; name: string; rows: NursingActivityValues[] }>();
  for (const activity of activities) {
    if (activity.type !== null) continue;
    const key = activity.interventionCode || activity.interventionName;
    const group = groups.get(key) ?? { code: activity.interventionCode, name: activity.interventionName, rows: [] };
    group.rows.push(activity);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** 行の区分の表示(OP/TP/EP、または看護介入の名称)。 */
export function nursingActivityLabel(activity: NursingActivityValues): string {
  return activity.type ? NURSING_ACTIVITY_TYPE_LABELS[activity.type] : activity.interventionName || "看護介入";
}

export function emptyNursingProblemForm(entry: NursingProblemEntry): NursingProblemFormValues {
  return {
    entry,
    diagnosis: null,
    name: "",
    factors: [],
    goals: [emptyNursingGoal()],
    activities: [],
    onsetDate: today(),
    standardPlanCode: "",
  };
}

/** マスタの看護診断を選んだ。名称を埋め、選び直したら因子は空にする。 */
export function withDiagnosis(values: NursingProblemFormValues, term: NursingTerm): NursingProblemFormValues {
  return {
    ...values,
    diagnosis: { code: term.code, name: term.name },
    name: term.name,
    factors: values.diagnosis?.code === term.code ? values.factors : [],
  };
}

/** 因子のチェック。マスタの付随項目をそのまま選ぶ(自由記載は code 空)。 */
export function toggleFactor(
  values: NursingProblemFormValues,
  factor: NursingFactorValues,
  checked: boolean,
): NursingProblemFormValues {
  const same = (f: NursingFactorValues) => f.kind === factor.kind && f.name === factor.name;
  const factors = values.factors.filter((f) => !same(f));
  return { ...values, factors: checked ? [...factors, factor] : factors };
}

/** 標準看護計画が参照する看護成果・看護介入の名称(コード → 名称)。 */
export interface TermNames {
  outcomes: Map<string, string>;
  interventions: Map<string, string>;
}

/** 標準看護計画を流し込む。目標と OP/TP/EP の行を置き換える(評価予定日は空で入れる)。 */
export function applyStandardPlan(
  values: NursingProblemFormValues,
  plan: NursingStandardPlan,
  names: TermNames,
): NursingProblemFormValues {
  return {
    ...values,
    standardPlanCode: plan.code,
    goals: plan.goals.map((goal) => ({
      ...emptyNursingGoal(),
      text: goal.text,
      outcomeCode: goal.outcome_code ?? "",
      outcomeName: names.outcomes.get(goal.outcome_code ?? "") ?? "",
    })),
    activities: plan.activities.map((row) => ({
      id: crypto.randomUUID(),
      type: row.activity_type,
      text: row.text,
      interventionCode: row.intervention_code ?? "",
      interventionName: names.interventions.get(row.intervention_code ?? "") ?? "",
      item: standardPlanItem(row.item_kind, row.code16, row.manage_no, row.item_name),
      stopped: false,
    })),
  };
}

/**
 * 標準看護計画から立案する。計画に看護診断が結びついていればその診断を看護問題にし、
 * 無ければ計画名を看護問題名にする。目標と OP/TP/EP は applyStandardPlan と同じく置き換える。
 */
export function startFromStandardPlan(
  values: NursingProblemFormValues,
  plan: NursingStandardPlan,
  diagnosis: NursingTerm | undefined,
  names: TermNames,
): NursingProblemFormValues {
  const base = diagnosis
    ? withDiagnosis(values, diagnosis)
    : { ...values, diagnosis: null, name: plan.name, factors: [] };
  return applyStandardPlan(base, plan, names);
}

function standardPlanItem(
  kind: string | undefined,
  code16: string | undefined,
  manageNo: string | undefined,
  name: string | undefined,
): NursingItemRef {
  if (kind === "act" && code16) return { kind: "act", code16, manageNo: manageNo ?? "", display: name ?? "" };
  if (kind === "observation" && manageNo) return { kind: "observation", manageNo, display: name ?? "" };
  return null;
}

export function validateNursingProblemForm(values: NursingProblemFormValues): string {
  if (!values.name.trim()) return "看護問題を入れてください。";
  if (!values.onsetDate) return "立案日を入れてください。";
  if (!values.goals.some((g) => g.text.trim())) return "目標を 1 つ以上入れてください。";
  for (const goal of values.goals) {
    if (goal.dueDate && goal.dueDate < values.onsetDate) return "評価予定日は立案日以降にしてください。";
  }
  return "";
}

// ---- 組み立て ----

/** 保存済みの看護問題 1 件分。 */
export interface NursingProblemRecord {
  condition: fhir4.Condition;
  carePlan: fhir4.CarePlan;
  goals: fhir4.Goal[];
}

export interface NursingCareContext {
  patientId: string;
  encounterId?: string;
  recorder: { practitionerId: string; display: string };
}

function practitionerReference(recorder: NursingCareContext["recorder"]): fhir4.Reference | undefined {
  if (!recorder.practitionerId) return undefined;
  return {
    reference: `Practitioner/${recorder.practitionerId}`,
    ...(recorder.display ? { display: recorder.display } : {}),
  };
}

function problemCode(values: NursingProblemFormValues): fhir4.CodeableConcept {
  const text = values.name.trim();
  if (!values.diagnosis) return { text };
  return {
    coding: [{ system: NURSING_DIAGNOSIS_SYSTEM, code: values.diagnosis.code, display: values.diagnosis.name }],
    text,
  };
}

function factorEvidence(factors: NursingFactorValues[]): fhir4.ConditionEvidence[] | undefined {
  if (factors.length === 0) return undefined;
  return factors.map((factor) => ({
    code: [
      factor.code
        ? { coding: [{ system: FACTOR_SYSTEMS[factor.kind], code: factor.code, display: factor.name }], text: factor.name }
        : { coding: [{ system: FACTOR_SYSTEMS[factor.kind] }], text: factor.name },
    ],
  }));
}

function buildCondition(
  values: NursingProblemFormValues,
  ctx: NursingCareContext,
  priority: number,
  original: fhir4.Condition | undefined,
): fhir4.Condition {
  const condition: fhir4.Condition = {
    ...(original ?? {}),
    resourceType: "Condition",
    clinicalStatus: original?.clinicalStatus ?? {
      coding: [{ system: CLINICAL_STATUS_SYSTEM, code: "active" }],
    },
    verificationStatus: original?.verificationStatus ?? {
      coding: [{ system: VERIFICATION_STATUS_SYSTEM, code: "confirmed" }],
    },
    category: [
      { coding: [{ system: CONDITION_CATEGORY_SYSTEM, code: "problem-list-item", display: "Problem List Item" }] },
      { coding: [{ ...NURSING_PROBLEM_CATEGORY }] },
    ],
    code: problemCode(values),
    subject: { reference: `Patient/${ctx.patientId}` },
    onsetDateTime: values.onsetDate,
    extension: [
      ...(original?.extension ?? []).filter((e) => e.url !== PRIORITY_EXT_URL),
      { url: PRIORITY_EXT_URL, valuePositiveInt: priority },
    ],
  };
  const evidence = factorEvidence(values.factors);
  if (evidence) condition.evidence = evidence;
  else delete condition.evidence;
  if (!original) {
    if (ctx.encounterId) condition.encounter = { reference: `Encounter/${ctx.encounterId}` };
    const recorder = practitionerReference(ctx.recorder);
    if (recorder) condition.recorder = recorder;
    condition.recordedDate = nowFhirDateTime();
  }
  return condition;
}

function buildGoal(
  goal: NursingGoalValues,
  conditionRef: string,
  ctx: NursingCareContext,
  startDate: string,
  original: fhir4.Goal | undefined,
): fhir4.Goal {
  const text = goal.text.trim();
  const next: fhir4.Goal = {
    ...(original ?? {}),
    resourceType: "Goal",
    lifecycleStatus: original?.lifecycleStatus ?? "active",
    category: [NURSING_CARE_CATEGORY],
    description: goal.outcomeCode
      ? { coding: [{ system: NURSING_OUTCOME_SYSTEM, code: goal.outcomeCode, display: goal.outcomeName || undefined }], text }
      : { text },
    subject: { reference: `Patient/${ctx.patientId}` },
    startDate: original?.startDate ?? startDate,
    addresses: [{ reference: conditionRef }],
  };
  if (goal.dueDate) next.target = [{ dueDate: goal.dueDate }];
  else delete next.target;
  return next;
}

function activityOf(values: NursingActivityValues): fhir4.CarePlanActivity {
  const extension: fhir4.Extension[] = values.type ? [{ url: ACTIVITY_TYPE_EXT_URL, valueCode: values.type }] : [];
  if (values.interventionCode || values.interventionName) {
    extension.push({
      url: INTERVENTION_EXT_URL,
      valueCoding: {
        system: NURSING_INTERVENTION_SYSTEM,
        ...(values.interventionCode ? { code: values.interventionCode } : {}),
        ...(values.interventionName ? { display: values.interventionName } : {}),
      },
    });
  }
  return {
    id: values.id,
    extension,
    detail: {
      status: values.stopped ? "stopped" : "in-progress",
      code: nursingItemConcept(values.item, values.text),
      description: values.text.trim(),
    },
  };
}

function buildCarePlan(
  values: NursingProblemFormValues,
  conditionRef: string,
  goalRefs: string[],
  ctx: NursingCareContext,
  original: fhir4.CarePlan | undefined,
): fhir4.CarePlan {
  const carePlan: fhir4.CarePlan = {
    ...(original ?? {}),
    resourceType: "CarePlan",
    status: original?.status ?? "active",
    intent: "plan",
    category: [NURSING_CARE_CATEGORY],
    title: values.name.trim(),
    subject: { reference: `Patient/${ctx.patientId}` },
    period: { ...(original?.period ?? {}), start: values.onsetDate },
    addresses: [{ reference: conditionRef }],
    goal: goalRefs.map((reference) => ({ reference })),
    activity: values.activities.filter((a) => a.text.trim()).map(activityOf),
  };
  carePlan.extension = [
    ...(original?.extension ?? []).filter((e) => e.url !== ENTRY_EXT_URL),
    { url: ENTRY_EXT_URL, valueCode: values.entry },
  ];
  if (values.standardPlanCode) carePlan.instantiatesUri = [`${STANDARD_PLAN_URI_BASE}${values.standardPlanCode}`];
  else delete carePlan.instantiatesUri;
  if (carePlan.activity?.length === 0) delete carePlan.activity;
  if (!original) {
    if (ctx.encounterId) carePlan.encounter = { reference: `Encounter/${ctx.encounterId}` };
    const author = practitionerReference(ctx.recorder);
    if (author) carePlan.author = author;
    carePlan.created = nowFhirDateTime();
  }
  return carePlan;
}

/**
 * 看護問題の新規登録・更新。Condition・Goal・CarePlan を 1 transaction で書く。
 * 更新で外した目標は削除せず中止(cancelled)にし、計画の goal からも外す(評価の履歴を残す)。
 */
export function buildNursingProblemBundle(
  values: NursingProblemFormValues,
  ctx: NursingCareContext,
  priority: number,
  existing?: NursingProblemRecord,
): fhir4.Bundle {
  const entries: fhir4.BundleEntry[] = [];
  const conditionUrl = existing ? `Condition/${existing.condition.id}` : `urn:uuid:${crypto.randomUUID()}`;
  const condition = buildCondition(values, ctx, priority, existing?.condition);
  entries.push(
    existing
      ? { fullUrl: conditionUrl, resource: condition, request: { method: "PUT", url: conditionUrl } }
      : { fullUrl: conditionUrl, resource: condition, request: { method: "POST", url: "Condition" } },
  );

  const originalGoals = new Map((existing?.goals ?? []).map((g) => [g.id ?? "", g]));
  const goalRefs: string[] = [];
  for (const goal of values.goals.filter((g) => g.text.trim())) {
    const original = goal.goalId ? originalGoals.get(goal.goalId) : undefined;
    const resource = buildGoal(goal, conditionUrl, ctx, values.onsetDate, original);
    if (original) {
      const url = `Goal/${original.id}`;
      goalRefs.push(url);
      entries.push({ fullUrl: url, resource, request: { method: "PUT", url } });
    } else {
      const url = `urn:uuid:${crypto.randomUUID()}`;
      goalRefs.push(url);
      entries.push({ fullUrl: url, resource, request: { method: "POST", url: "Goal" } });
    }
  }
  const kept = new Set(values.goals.map((g) => g.goalId).filter(Boolean));
  for (const removed of existing?.goals ?? []) {
    if (!removed.id || kept.has(removed.id) || removed.lifecycleStatus === "cancelled") continue;
    const url = `Goal/${removed.id}`;
    entries.push({
      fullUrl: url,
      resource: goalWith(removed, { lifecycleStatus: "cancelled" }),
      request: { method: "PUT", url },
    });
  }

  const carePlanUrl = existing ? `CarePlan/${existing.carePlan.id}` : `urn:uuid:${crypto.randomUUID()}`;
  const carePlan = buildCarePlan(values, conditionUrl, goalRefs, ctx, existing?.carePlan);
  entries.push(
    existing
      ? { fullUrl: carePlanUrl, resource: carePlan, request: { method: "PUT", url: carePlanUrl } }
      : { fullUrl: carePlanUrl, resource: carePlan, request: { method: "POST", url: "CarePlan" } },
  );

  const bundle = transactionBundle(entries);
  return existing
    ? withVersionLock(bundle, existing.condition, existing.carePlan, ...existing.goals)
    : bundle;
}

/** 優先度の入れ替え。番号の変わった看護問題だけを PUT する(読んだ版を添える)。 */
export function buildNursingPriorityBundle(conditionsInOrder: fhir4.Condition[]): fhir4.Bundle {
  const entries = conditionsInOrder.flatMap((condition, index): fhir4.BundleEntry[] => {
    const priority = index + 1;
    if (nursingProblemPriority(condition) === priority) return [];
    const next: fhir4.Condition = {
      ...condition,
      extension: [
        ...(condition.extension ?? []).filter((e) => e.url !== PRIORITY_EXT_URL),
        { url: PRIORITY_EXT_URL, valuePositiveInt: priority },
      ],
    };
    return [{ resource: next, request: { method: "PUT", url: `Condition/${condition.id}` } }];
  });
  return transactionBundle(entries);
}

// ---- 評価 ----

export interface NursingGoalEvaluationValues {
  goalId: string;
  achievement: NursingAchievement | "";
  note: string;
  /** 次の評価予定日。空なら目標の評価予定日を外す。 */
  nextDueDate: string;
}

export interface NursingEvaluationValues {
  date: string;
  goals: NursingGoalEvaluationValues[];
  decision: NursingDecision;
  note: string;
}

export function emptyNursingEvaluation(record: NursingProblemRecord): NursingEvaluationValues {
  return {
    date: today(),
    goals: activeGoals(record.goals).map((goal) => ({
      goalId: goal.id ?? "",
      achievement: "",
      note: "",
      nextDueDate: goal.target?.[0]?.dueDate ?? "",
    })),
    decision: "continue",
    note: "",
  };
}

export function validateNursingEvaluation(values: NursingEvaluationValues): string {
  if (!values.date) return "評価日を入れてください。";
  if (!values.goals.some((g) => g.achievement) && !values.note.trim()) {
    return "達成度か評価の内容を入れてください。";
  }
  return "";
}

/**
 * 評価の登録。目標ごとの評価と問題単位の判定を Observation で残し、Goal の達成度を更新する。
 * 解決のときは看護問題を resolved、計画を completed にし、展開した看護指示に終了日を入れる。
 */
export function buildNursingEvaluationBundle(
  record: NursingProblemRecord,
  values: NursingEvaluationValues,
  ctx: NursingCareContext,
  orders: fhir4.ServiceRequest[],
): fhir4.Bundle {
  const carePlanId = record.carePlan.id ?? "";
  const conditionId = record.condition.id ?? "";
  const subject = { reference: `Patient/${ctx.patientId}` };
  const performer = practitionerReference(ctx.recorder);
  const effective = values.date === today() ? nowFhirDateTime() : values.date;
  const base = {
    resourceType: "Observation" as const,
    status: "final" as const,
    category: [NURSING_CARE_CATEGORY],
    subject,
    effectiveDateTime: effective,
    ...(performer ? { performer: [performer] } : {}),
    basedOn: [{ reference: `CarePlan/${carePlanId}` }],
    extension: [{ url: VITAL_PROBLEM_EXT_URL, valueReference: { reference: `Condition/${conditionId}` } }],
    ...(ctx.encounterId ? { encounter: { reference: `Encounter/${ctx.encounterId}` } } : {}),
  };

  const entries: fhir4.BundleEntry[] = [];
  const goalsById = new Map(record.goals.map((g) => [g.id ?? "", g]));
  const resolve = values.decision === "resolve";

  for (const item of values.goals) {
    const goal = goalsById.get(item.goalId);
    if (!goal?.id || (!item.achievement && !item.note.trim())) continue;
    const observationUrl = `urn:uuid:${crypto.randomUUID()}`;
    const observation: fhir4.Observation = {
      ...base,
      code: {
        coding: [{ system: NURSING_EVALUATION_SYSTEM, code: "goal", display: "目標の評価" }],
        text: goal.description.text,
      },
      focus: [{ reference: `Goal/${goal.id}` }],
      ...(item.achievement
        ? {
            valueCodeableConcept: {
              coding: [
                {
                  system: GOAL_ACHIEVEMENT_SYSTEM,
                  code: item.achievement,
                  display: displayOf(NURSING_ACHIEVEMENT_OPTIONS, item.achievement),
                },
              ],
            },
          }
        : {}),
      ...(item.note.trim() ? { note: [{ text: item.note.trim() }] } : {}),
    };
    entries.push({ fullUrl: observationUrl, resource: observation, request: { method: "POST", url: "Observation" } });

    const nextGoal: fhir4.Goal = {
      ...goal,
      statusDate: values.date,
      outcomeReference: [...(goal.outcomeReference ?? []), { reference: observationUrl }],
    };
    if (item.achievement) {
      nextGoal.achievementStatus = {
        coding: [
          {
            system: GOAL_ACHIEVEMENT_SYSTEM,
            code: item.achievement,
            display: displayOf(NURSING_ACHIEVEMENT_OPTIONS, item.achievement),
          },
        ],
      };
    }
    if (resolve || item.achievement === "achieved") nextGoal.lifecycleStatus = "completed";
    if (item.nextDueDate && !resolve) nextGoal.target = [{ dueDate: item.nextDueDate }];
    else delete nextGoal.target;
    entries.push({ resource: nextGoal, request: { method: "PUT", url: `Goal/${goal.id}` } });
  }

  // 問題単位の判定(継続・修正・解決)と全体の評価。
  const problemEvaluation: fhir4.Observation = {
      ...base,
      code: {
        coding: [{ system: NURSING_EVALUATION_SYSTEM, code: "problem", display: "看護問題の評価" }],
        text: record.condition.code?.text,
      },
      focus: [{ reference: `Condition/${conditionId}` }],
      valueCodeableConcept: {
        coding: [
          {
            system: DECISION_SYSTEM,
            code: values.decision,
            display: displayOf(NURSING_DECISION_OPTIONS, values.decision),
          },
        ],
      },
      ...(values.note.trim() ? { note: [{ text: values.note.trim() }] } : {}),
  };
  entries.push({ resource: problemEvaluation, request: { method: "POST", url: "Observation" } });

  if (resolve) {
    entries.push(...resolveEntries(record, values.date, orders, "resolved"));
    // 目標を評価しなかった継続中の目標も閉じる。
    for (const goal of activeGoals(record.goals)) {
      if (values.goals.some((g) => g.goalId === goal.id && (g.achievement || g.note.trim()))) continue;
      entries.push({
        resource: goalWith(goal, { lifecycleStatus: "completed", statusDate: values.date }),
        request: { method: "PUT", url: `Goal/${goal.id}` },
      });
    }
  }

  return withVersionLock(transactionBundle(entries), record.condition, record.carePlan, ...record.goals);
}

/** 解決・取消で看護問題と計画を閉じ、展開した看護指示を止める PUT エントリ。 */
function resolveEntries(
  record: NursingProblemRecord,
  date: string,
  orders: fhir4.ServiceRequest[],
  mode: "resolved" | "entered-in-error",
): fhir4.BundleEntry[] {
  const condition: fhir4.Condition =
    mode === "resolved"
      ? {
          ...record.condition,
          clinicalStatus: { coding: [{ system: CLINICAL_STATUS_SYSTEM, code: "resolved" }] },
          abatementDateTime: date,
        }
      : {
          ...record.condition,
          verificationStatus: { coding: [{ system: VERIFICATION_STATUS_SYSTEM, code: "entered-in-error" }] },
        };
  const carePlan: fhir4.CarePlan = {
    ...record.carePlan,
    status: mode === "resolved" ? "completed" : "entered-in-error",
    period: { ...(record.carePlan.period ?? {}), end: date },
  };
  const orderEntries =
    mode === "resolved"
      ? orders.filter((sr) => nursingOrderNeedsStop(sr, date)).map((sr) => buildNursingOrderCloseEntry(sr, date))
      : orders.filter((sr) => sr.status === "active").map(buildNursingOrderRevokeEntry);
  return [
    { resource: condition, request: { method: "PUT", url: `Condition/${record.condition.id}` } },
    { resource: carePlan, request: { method: "PUT", url: `CarePlan/${record.carePlan.id}` } },
    ...orderEntries,
  ];
}

/** 取消(誤って立てた看護問題)。看護問題を entered-in-error にし、展開した看護指示を中止する。 */
export function buildNursingProblemCancelBundle(
  record: NursingProblemRecord,
  orders: fhir4.ServiceRequest[],
): fhir4.Bundle {
  const entries = [
    ...resolveEntries(record, today(), orders, "entered-in-error"),
    ...activeGoals(record.goals).map(
      (goal): fhir4.BundleEntry => ({
        resource: goalWith(goal, { lifecycleStatus: "entered-in-error" }),
        request: { method: "PUT", url: `Goal/${goal.id}` },
      }),
    ),
  ];
  return withVersionLock(transactionBundle(entries), record.condition, record.carePlan, ...record.goals);
}

// ---- 読み取り ----

export function nursingProblemPriority(condition: fhir4.Condition): number | undefined {
  const value = condition.extension?.find((e) => e.url === PRIORITY_EXT_URL)?.valuePositiveInt;
  return typeof value === "number" ? value : undefined;
}

export function isNursingCarePlan(carePlan: fhir4.CarePlan): boolean {
  return (carePlan.category ?? []).some((c) =>
    c.coding?.some((coding) => coding.system === PATHWAY_MARKER_SYSTEM && coding.code === NURSING_CARE_PLAN_CODE),
  );
}

export function isActiveNursingProblem(condition: fhir4.Condition): boolean {
  return condition.clinicalStatus?.coding?.[0]?.code === "active";
}

function goalWith(goal: fhir4.Goal, patch: Partial<fhir4.Goal>): fhir4.Goal {
  return { ...goal, ...patch };
}

function activeGoals(goals: fhir4.Goal[]): fhir4.Goal[] {
  return goals.filter((g) => g.lifecycleStatus !== "cancelled" && g.lifecycleStatus !== "entered-in-error");
}

export function nursingDiagnosisCode(condition: fhir4.Condition): string {
  return codingBySystem(condition.code?.coding, NURSING_DIAGNOSIS_SYSTEM)?.code ?? "";
}

function factorOf(evidence: fhir4.ConditionEvidence): NursingFactorValues | null {
  const concept = evidence.code?.[0];
  for (const [kind, system] of Object.entries(FACTOR_SYSTEMS) as [NursingFactorKind, string][]) {
    const coding = codingBySystem(concept?.coding, system);
    if (coding) return { kind, code: coding.code ?? "", name: concept?.text ?? coding.display ?? "" };
  }
  return null;
}

export function nursingProblemFactors(condition: fhir4.Condition): NursingFactorValues[] {
  return (condition.evidence ?? []).map(factorOf).filter((f): f is NursingFactorValues => f !== null);
}

function activityValuesOf(activity: fhir4.CarePlanActivity): NursingActivityValues {
  const type = activity.extension?.find((e) => e.url === ACTIVITY_TYPE_EXT_URL)?.valueCode;
  const concept = activity.detail?.code;
  const act = codingBySystem(concept?.coding, NURSING_ACT_CODE_SYSTEM);
  const obs = codingBySystem(concept?.coding, NURSING_OBSERVATION_CODE_SYSTEM);
  const item: NursingItemRef = act?.code
    ? {
        kind: "act",
        code16: act.code,
        manageNo: codingBySystem(concept?.coding, NURSING_ACT_MANAGE_NO_SYSTEM)?.code ?? "",
        display: act.display ?? "",
      }
    : obs?.code
      ? { kind: "observation", manageNo: obs.code, display: obs.display ?? "" }
      : null;
  return {
    id: activity.id ?? crypto.randomUUID(),
    type: type === "op" || type === "tp" || type === "ep" ? type : null,
    text: activity.detail?.description ?? concept?.text ?? "",
    interventionCode:
      activity.extension?.find((e) => e.url === INTERVENTION_EXT_URL)?.valueCoding?.code ?? "",
    interventionName:
      activity.extension?.find((e) => e.url === INTERVENTION_EXT_URL)?.valueCoding?.display ?? "",
    item,
    stopped: activity.detail?.status === "stopped",
  };
}

export function nursingPlanActivities(carePlan: fhir4.CarePlan): NursingActivityValues[] {
  return (carePlan.activity ?? []).map(activityValuesOf);
}

function standardPlanCodeOf(carePlan: fhir4.CarePlan): string {
  const uri = carePlan.instantiatesUri?.find((u) => u.startsWith(STANDARD_PLAN_URI_BASE));
  return uri ? uri.slice(STANDARD_PLAN_URI_BASE.length) : "";
}

export function parseNursingProblemForm(record: NursingProblemRecord): NursingProblemFormValues {
  const diagnosisCoding = codingBySystem(record.condition.code?.coding, NURSING_DIAGNOSIS_SYSTEM);
  return {
    entry: nursingCarePlanEntryOf(record.carePlan),
    diagnosis: diagnosisCoding?.code
      ? { code: diagnosisCoding.code, name: diagnosisCoding.display ?? "" }
      : null,
    name: record.condition.code?.text ?? diagnosisCoding?.display ?? "",
    factors: nursingProblemFactors(record.condition),
    goals: activeGoals(record.goals)
      .filter((g) => g.lifecycleStatus === "active" || g.lifecycleStatus === "proposed")
      .map((goal) => ({
        goalId: goal.id ?? "",
        text: goal.description.text ?? "",
        outcomeCode: codingBySystem(goal.description.coding, NURSING_OUTCOME_SYSTEM)?.code ?? "",
        outcomeName: codingBySystem(goal.description.coding, NURSING_OUTCOME_SYSTEM)?.display ?? "",
        dueDate: goal.target?.[0]?.dueDate ?? "",
      })),
    activities: nursingPlanActivities(record.carePlan),
    onsetDate: (record.condition.onsetDateTime ?? "").slice(0, 10) || today(),
    standardPlanCode: standardPlanCodeOf(record.carePlan),
  };
}

export interface NursingEvaluationEntry {
  observation: fhir4.Observation;
  kind: "goal" | "problem";
  date: string;
  /** 達成度または判定の表示。 */
  result: string;
  note: string;
  performer: string;
  /** 目標の評価なら目標の id。 */
  goalId: string;
}

function evaluationEntryOf(observation: fhir4.Observation): NursingEvaluationEntry | null {
  const kind = codingBySystem(observation.code.coding, NURSING_EVALUATION_SYSTEM)?.code;
  if (kind !== "goal" && kind !== "problem") return null;
  const value = observation.valueCodeableConcept?.coding?.[0];
  return {
    observation,
    kind,
    date: observation.effectiveDateTime ?? "",
    result: value?.display ?? "",
    note: observation.note?.map((n) => n.text).join("\n") ?? "",
    performer: observation.performer?.[0]?.display ?? "",
    goalId: referenceIdOfType(observation.focus?.[0]?.reference, "Goal"),
  };
}

/** 画面に並べる看護問題 1 件。 */
export interface NursingProblemView extends NursingProblemRecord {
  /** 立案の入口(看護計画タブの区画)。 */
  entry: NursingProblemEntry;
  priority: number;
  active: boolean;
  name: string;
  onsetDate: string;
  abatementDate: string;
  factors: NursingFactorValues[];
  activities: NursingActivityValues[];
  /** 新しい順。 */
  evaluations: NursingEvaluationEntry[];
  /** 展開した看護指示(行の id ごと)。 */
  ordersByActivity: Map<string, fhir4.ServiceRequest[]>;
  /** 計画の行に結び付かない、この問題を対象とした看護指示。 */
  otherOrders: fhir4.ServiceRequest[];
}

/**
 * 検索結果を看護問題ごとにまとめる。取消(entered-in-error)は落とし、継続中を優先度順、
 * 解決済みをその後ろ(解決日の新しい順)に並べる。
 */
export function assembleNursingProblems(
  carePlans: fhir4.CarePlan[],
  conditions: fhir4.Condition[],
  goals: fhir4.Goal[],
  evaluations: fhir4.Observation[],
  orders: fhir4.ServiceRequest[],
): NursingProblemView[] {
  const conditionById = new Map(conditions.map((c) => [c.id ?? "", c]));
  const goalById = new Map(goals.map((g) => [g.id ?? "", g]));
  const evaluationsByPlan = new Map<string, NursingEvaluationEntry[]>();
  for (const observation of evaluations) {
    const entry = evaluationEntryOf(observation);
    const planId = referenceIdOfType(observation.basedOn?.[0]?.reference, "CarePlan");
    if (!entry || !planId) continue;
    const list = evaluationsByPlan.get(planId) ?? [];
    list.push(entry);
    evaluationsByPlan.set(planId, list);
  }

  const views: NursingProblemView[] = [];
  for (const carePlan of carePlans) {
    if (!isNursingCarePlan(carePlan) || carePlan.status === "entered-in-error") continue;
    const condition = conditionById.get(referenceIdOfType(carePlan.addresses?.[0]?.reference, "Condition"));
    if (!condition || condition.verificationStatus?.coding?.[0]?.code === "entered-in-error") continue;
    const planGoals = (carePlan.goal ?? [])
      .map((ref) => goalById.get(referenceIdOfType(ref.reference, "Goal")))
      .filter((g): g is fhir4.Goal => Boolean(g));
    const planOrders = orders.filter((sr) =>
      sr.reasonReference?.some((r) => r.reference === `Condition/${condition.id}`),
    );
    const ordersByActivity = new Map<string, fhir4.ServiceRequest[]>();
    const otherOrders: fhir4.ServiceRequest[] = [];
    for (const sr of planOrders) {
      const ref = planActivityOf(sr);
      if (ref && ref.carePlanId === carePlan.id) {
        ordersByActivity.set(ref.activityId, [...(ordersByActivity.get(ref.activityId) ?? []), sr]);
      } else {
        otherOrders.push(sr);
      }
    }
    views.push({
      condition,
      carePlan,
      goals: planGoals,
      entry: nursingCarePlanEntryOf(carePlan),
      priority: nursingProblemPriority(condition) ?? Number.MAX_SAFE_INTEGER,
      active: isActiveNursingProblem(condition),
      name: condition.code?.text ?? "",
      onsetDate: (condition.onsetDateTime ?? "").slice(0, 10),
      abatementDate: (condition.abatementDateTime ?? "").slice(0, 10),
      factors: nursingProblemFactors(condition),
      activities: nursingPlanActivities(carePlan),
      evaluations: (evaluationsByPlan.get(carePlan.id ?? "") ?? []).sort((a, b) => b.date.localeCompare(a.date)),
      ordersByActivity,
      otherOrders,
    });
  }
  return views.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.active) return a.priority - b.priority || a.onsetDate.localeCompare(b.onsetDate);
    return b.abatementDate.localeCompare(a.abatementDate);
  });
}

/** 次に立てる看護問題の優先度(継続中の末尾)。 */
export function nextNursingPriority(views: NursingProblemView[]): number {
  return views.filter((v) => v.active).length + 1;
}

/** 目標の表示(期限超過の判定込み)。 */
export interface NursingGoalView {
  goal: fhir4.Goal;
  text: string;
  /** 結びついた看護成果(NOC)の名称。 */
  outcomeName: string;
  dueDate: string;
  overdue: boolean;
  achievement: string;
  status: fhir4.Goal["lifecycleStatus"];
}

export function nursingGoalViews(goals: fhir4.Goal[], at: string): NursingGoalView[] {
  return activeGoals(goals).map((goal) => {
    const dueDate = goal.target?.[0]?.dueDate ?? "";
    return {
      goal,
      text: goal.description.text ?? "",
      outcomeName: codingBySystem(goal.description.coding, NURSING_OUTCOME_SYSTEM)?.display ?? "",
      dueDate,
      overdue: goal.lifecycleStatus === "active" && Boolean(dueDate) && dueDate < at,
      achievement: goal.achievementStatus?.coding?.[0]?.display ?? "",
      status: goal.lifecycleStatus,
    };
  });
}

/** 計画の行を看護指示の行に写す(頻度・開始日は指示の入力で決める)。 */
export function planActivityOrderLines(
  activities: NursingActivityValues[],
  carePlanId: string,
): NursingOrderLineValues[] {
  return activities.map((activity) => ({
    ...emptyNursingOrderLine(),
    item: activity.item,
    text: activity.text,
    planActivity: { carePlanId, activityId: activity.id },
  }));
}

/** 指示簿などで「看護計画から展開した指示」の印を出すための判定。 */
export function isPlanDerivedOrder(sr: fhir4.ServiceRequest): boolean {
  return planActivityOf(sr) !== undefined;
}

