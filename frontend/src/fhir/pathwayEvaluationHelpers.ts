import type { NursingObservation } from "../api/masterClient";
import type { TemplateBinding } from "./questionnaireResponseHelpers";
import { localDay, nowFhirDateTime } from "../lib/dates";
import {
  nursingObservationInputSpec,
  nursingObservationValueLabel,
  type NursingObservationInputSpec,
} from "./nursingPerformHelpers";
import {
  PATHWAY_MARKER_CODE,
  PATHWAY_MARKER_SYSTEM,
  isAssessmentGoal,
  pathwayLevelOf,
  type PathwayAssessmentRecord,
  type PathwayEventRecord,
  type PathwayOatUnitRecord,
} from "./pathwayApplyHelpers";
import { eventDayStepLabel, type PathwayProperCriteria } from "./pathwayHelpers";
import { NURSING_OBSERVATION_RESULT_SYSTEM, nursingVitalCodeOf } from "./nursingPerformHelpers";
import { NURSING_OBSERVATION_CODE_SYSTEM } from "./nursingOrderHelpers";
import { buildBloodPressureComponents } from "./vitalHelpers";
import { departmentExtension, type DepartmentRef } from "./orderHeader";
import { pathwayVarianceTaskEntries, type PathwayVarianceNotice } from "./pathwayVarianceHelpers";
import { LOINC_SYSTEM } from "./shared";

// クリニカルパスの日次評価(1 病日 × 1 OAT ユニット)の FHIR 構造。ePath の適用後パスデータに倣う。
// React に依存しない。設計は docs/clinical-pathway-design.md §7.4。
//
//   Goal(アウトカム)            identifier outcome-goal-id、achievementStatus = 1 達成 / 2 未達成 / 3 未評価、
//                              outcomeReference → 評価の Observation。CarePlan(OAT ユニット).goal がこれを指す
//   Observation(評価)           code = judgement、value = 達成状態、component = S/O/A/P、basedOn → CarePlan(OAT ユニット)
//   Observation(観察項目の実績) code = 観察項目のコード、value = 実績値、basedOn → CarePlan(観察項目)
//   Procedure(タスク)           status = completed(実施)/ preparation(未実施)、performedDateTime、performer
//   Observation(病日の総合評価)  code = comp-assessment、valueString = 本文、basedOn → CarePlan(病日)。病日に 1 件(上書き)
//   Goal(観察項目の適正値)       achievementStatus = 実績値を基準(下限・上限・許容値)に当てた 1 達成 / 2 未達成。
//                              基準か実績値が無ければ書かない(= ePath の 3 未評価)
//
// ［決定］評価・実績の Observation は Goal に contained せず独立のリソースにする(検索で読める。
// EP12 出力で contained に畳む)。category の先頭にパスの印を置き、患者 + category の 1 回の検索で
// 全部引く。
// ［決定］記録のたびに評価・実績の Observation を新しく作り(識別子の末尾が記録番号)、既存の Observation には
// PUT も DELETE もしない(1 日に複数回の評価を全部残す。設計 §7.16)。Goal は最新を指す。

const ID_SYSTEM_BASE = "http://e-path.jp/fhir/ePath/IdSystem";
export const PATHWAY_OUTCOME_GOAL_ID_SYSTEM = `${ID_SYSTEM_BASE}/outcome-goal-id`;
export const PATHWAY_EVALUATION_ID_SYSTEM = `${ID_SYSTEM_BASE}/observation-evaluation-id`;
export const PATHWAY_RESULT_ID_SYSTEM = `${ID_SYSTEM_BASE}/observation-result-id`;
export const PATHWAY_DAY_ASSESSMENT_ID_SYSTEM = `${ID_SYSTEM_BASE}/observation-comp-assessment-id`;

const CS_BASE = "http://e-path.jp/fhir/ePath/CodeSystem";
export const EVALUATION_ITEM_SYSTEM = `${CS_BASE}/EPathEvaluationItemCS`;
export const ACHIEVEMENT_SYSTEM = `${CS_BASE}/EPathStateOfAchievementCS`;

/** ePath の達成状態。 */
export type Achievement = "1" | "2" | "3";
export const ACHIEVEMENT_OPTIONS: { code: Achievement; display: string }[] = [
  { code: "1", display: "達成" },
  { code: "2", display: "未達成（バリアンス）" },
  { code: "3", display: "未評価" },
];

export function achievementLabel(code: string | undefined): string {
  return ACHIEVEMENT_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

/** 評価 Observation の component(S/O/A/P)のコードと表示。 */
export const SOAP_ITEMS: { code: "S" | "O" | "A" | "P"; label: string }[] = [
  { code: "S", label: "S" },
  { code: "O", label: "O" },
  { code: "A", label: "A" },
  { code: "P", label: "P" },
];

/** 自由記載(ePath の総合評価)の component コード。 */
export const FREE_TEXT_CODE = "comp-assessment";

/** 記載形式。SOAP(4 欄)か自由記載(1 欄)。 */
export type EvaluationMode = "soap" | "free";

/** 記載欄の識別子(S/O/A/P と自由記載)。テンプレートの紐付けをこの単位で持つ。 */
export type EvaluationField = "S" | "O" | "A" | "P" | "free";

/**
 * 記載欄をテンプレートから書いたときの回答(QuestionnaireResponse)への参照。
 * component に付けるので、どの欄がテンプレート由来かを欄ごとに持ち越せる。
 */
export const PATHWAY_EVALUATION_TEMPLATE_EXT_URL =
  "http://fhir-client.local/StructureDefinition/pathway-evaluation-template";

function templateRefOf(component: fhir4.ObservationComponent | undefined): string {
  return (
    component?.extension?.find((e) => e.url === PATHWAY_EVALUATION_TEMPLATE_EXT_URL)?.valueReference?.reference ?? ""
  );
}

function emptyTemplates(): Record<EvaluationField, TemplateBinding | null> {
  return { S: null, O: null, A: null, P: null, free: null };
}

/** Observation.category の先頭に置くパスの印(検索の鍵)。 */
export function pathwayObservationCategory(): fhir4.CodeableConcept {
  return { coding: [{ system: PATHWAY_MARKER_SYSTEM, code: PATHWAY_MARKER_CODE }] };
}

export function isPathwayObservation(observation: fhir4.Observation): boolean {
  return Boolean(
    observation.category?.[0]?.coding?.some(
      (c) => c.system === PATHWAY_MARKER_SYSTEM && c.code === PATHWAY_MARKER_CODE,
    ),
  );
}

function basedOnId(resource: { basedOn?: fhir4.Reference[] }): string {
  return resource.basedOn?.[0]?.reference?.split("/").pop() ?? "";
}

// ---- 読み出し ----

/** 評価の記録 1 回ぶん(評価 Observation 1 件から読めるもの)。 */
export interface EvaluationRecord {
  observation: fhir4.Observation | null;
  /** 記録番号(識別子の末尾。無印は 1)。 */
  recordNo: number;
  achievement: Achievement | "";
  /** 記載形式。自由記載(総合評価)の component があれば free。 */
  mode: EvaluationMode;
  soap: Record<"S" | "O" | "A" | "P", string>;
  freeText: string;
  /** 記載欄ごとのテンプレート紐付け(保存済みの回答への参照)。 */
  templates: Record<EvaluationField, TemplateBinding | null>;
  comment: string;
  recordedAt: string;
  performerName: string;
}

/** OAT ユニットの評価。項目は最新の記録のもので、history に全部の記録を古い順に持つ。 */
export interface UnitEvaluation extends EvaluationRecord {
  goal: fhir4.Goal | null;
  history: EvaluationRecord[];
}

/** 病日ごとの医師の総合評価(ePath の compAssessment)。病日に 1 件。 */
export interface DayAssessment {
  observation: fhir4.Observation;
  text: string;
  recordedAt: string;
  performerName: string;
}

export interface PathwayEvaluationState {
  /** OAT ユニット CarePlan の id → 評価。 */
  units: Map<string, UnitEvaluation>;
  /** 観察項目 CarePlan の id → 最新の実績の Observation。 */
  results: Map<string, fhir4.Observation>;
  /** 観察項目 CarePlan の id → 実績の Observation を記録順(古い順)に全部。 */
  resultHistory: Map<string, fhir4.Observation[]>;
  /** 観察項目 CarePlan の id → 記録済みの達成状態(適正値の Goal の achievementStatus)。無ければ未評価。 */
  assessments: Map<string, Achievement>;
  /** 病日 CarePlan の id → 総合評価。 */
  days: Map<string, DayAssessment>;
}

/** 記載(S/O/A/P・自由記載・コメント)があるか。バリアンスの記載の有無の判定に使う。 */
export function hasEvaluationWriting(
  evaluation: Pick<UnitEvaluation, "soap" | "freeText" | "comment"> | undefined,
): boolean {
  return Boolean(
    evaluation && (evaluation.freeText.trim() || Object.values(evaluation.soap).some((t) => t.trim()) || evaluation.comment.trim()),
  );
}

function isDayAssessmentObservation(observation: fhir4.Observation): boolean {
  return Boolean(
    observation.code?.coding?.some((c) => c.system === EVALUATION_ITEM_SYSTEM && c.code === FREE_TEXT_CODE),
  );
}

/** 評価・実績の Observation の記録番号(識別子の末尾の数字。無印は 1 回目)。 */
export function recordNoOf(observation: fhir4.Observation): number {
  const value =
    observation.identifier?.find((i) => i.system === PATHWAY_EVALUATION_ID_SYSTEM || i.system === PATHWAY_RESULT_ID_SYSTEM)
      ?.value ?? "";
  const match = /\.(\d+)$/.exec(value);
  return match ? Number(match[1]) : 1;
}

/** 記録順(記録番号 → 記録日時)。 */
function byRecordOrder(a: fhir4.Observation, b: fhir4.Observation): number {
  return recordNoOf(a) - recordNoOf(b) || (a.effectiveDateTime ?? "").localeCompare(b.effectiveDateTime ?? "");
}

function evaluationRecordOf(observation: fhir4.Observation | null): EvaluationRecord {
  const soap = { S: "", O: "", A: "", P: "" } as Record<"S" | "O" | "A" | "P", string>;
  const templates = emptyTemplates();
  let freeText = "";
  let mode: EvaluationMode = "soap";
  for (const component of observation?.component ?? []) {
    const code = component.code?.coding?.find((c) => c.system === EVALUATION_ITEM_SYSTEM)?.code;
    const responseId = templateRefOf(component).split("/").pop() ?? "";
    if (code === "S" || code === "O" || code === "A" || code === "P") {
      soap[code] = component.valueString ?? "";
      if (responseId) templates[code] = { responseId, draft: null };
    }
    if (code === FREE_TEXT_CODE) {
      freeText = component.valueString ?? "";
      mode = "free";
      if (responseId) templates.free = { responseId, draft: null };
    }
  }
  return {
    observation,
    recordNo: observation ? recordNoOf(observation) : 0,
    achievement: (observation?.valueCodeableConcept?.coding?.find((c) => c.system === ACHIEVEMENT_SYSTEM)?.code ??
      "") as Achievement | "",
    mode,
    soap,
    freeText,
    templates,
    comment: observation?.note?.[0]?.text ?? "",
    recordedAt: observation?.effectiveDateTime ?? "",
    performerName: observation?.performer?.[0]?.display ?? "",
  };
}

/** 次の記録番号(その OAT ユニットの評価・実績の記録番号の最大 + 1)。 */
export function nextRecordNo(unit: PathwayOatUnitRecord, state: PathwayEvaluationState | null): number {
  let max = 0;
  for (const record of state?.units.get(unit.id)?.history ?? []) max = Math.max(max, record.recordNo);
  for (const assessment of unit.assessments) {
    for (const result of state?.resultHistory.get(assessment.id) ?? []) max = Math.max(max, recordNoOf(result));
  }
  return max + 1;
}

/**
 * 患者のパス関連 Observation(評価と実績)と、木に含めた Goal から評価の状態を組む。
 * Goal は CarePlan(OAT ユニット).goal で結ばれるので、unit → goal は CarePlan 側から引く。
 * 評価・実績は記録順に並べ、最新を表に出す。
 */
export function buildEvaluationState(
  observations: fhir4.Observation[],
  goals: Map<string, fhir4.Goal>,
  carePlans: fhir4.CarePlan[],
): PathwayEvaluationState {
  const units = new Map<string, UnitEvaluation>();
  const results = new Map<string, fhir4.Observation>();
  const resultHistory = new Map<string, fhir4.Observation[]>();
  const assessments = new Map<string, Achievement>();
  const days = new Map<string, DayAssessment>();
  const evaluations = new Map<string, fhir4.Observation[]>();
  for (const observation of observations) {
    if (!isPathwayObservation(observation)) continue;
    const target = basedOnId(observation);
    if (!target) continue;
    if (isDayAssessmentObservation(observation)) {
      days.set(target, {
        observation,
        text: observation.valueString ?? "",
        recordedAt: observation.effectiveDateTime ?? "",
        performerName: observation.performer?.[0]?.display ?? "",
      });
      continue;
    }
    const isEvaluation = observation.code?.coding?.some(
      (c) => c.system === EVALUATION_ITEM_SYSTEM && c.code === "judgement",
    );
    const bucket = isEvaluation ? evaluations : resultHistory;
    bucket.set(target, [...(bucket.get(target) ?? []), observation]);
  }
  for (const [id, history] of resultHistory) {
    history.sort(byRecordOrder);
    results.set(id, history[history.length - 1]);
  }
  // 総合評価は病日の CarePlan を指すものだけ(OAT ユニットを指す古い記録は無いが、階層で確かめる)。
  for (const [id] of days) {
    const carePlan = carePlans.find((cp) => cp.id === id);
    if (carePlan && pathwayLevelOf(carePlan) !== "event") days.delete(id);
  }
  for (const assessment of carePlans) {
    if (!assessment.id || pathwayLevelOf(assessment) !== "assessment") continue;
    const goal = (assessment.goal ?? [])
      .map((ref) => goals.get(ref.reference?.split("/").pop() ?? ""))
      .find((g) => isAssessmentGoal(g));
    const code = goal?.achievementStatus?.coding?.find((c) => c.system === ACHIEVEMENT_SYSTEM)?.code;
    if (code === "1" || code === "2") assessments.set(assessment.id, code);
  }
  for (const unit of carePlans) {
    if (!unit.id || pathwayLevelOf(unit) !== "oat-unit") continue;
    const goalId = unit.goal?.[0]?.reference?.split("/").pop();
    const goal = goalId ? (goals.get(goalId) ?? null) : null;
    const history = (evaluations.get(unit.id) ?? []).sort(byRecordOrder).map(evaluationRecordOf);
    const latest = evaluationRecordOf(history[history.length - 1]?.observation ?? null);
    // 達成状態は Goal が正(評価 Observation が無い古い記録でも読める)。
    const achievement = (goal?.achievementStatus?.coding?.find((c) => c.system === ACHIEVEMENT_SYSTEM)?.code ??
      "") as Achievement | "";
    units.set(unit.id, { ...latest, achievement, goal, history });
  }
  return { units, results, resultHistory, assessments, days };
}

// ---- 適正値による判定 ----

/**
 * 実績値を観察項目の基準に当てた達成 / 未達成。基準が無い・値が入っていない・基準の種類と表現タイプが
 * 合わない(範囲の基準に文字の値など)ときは null(判定しない)。数値の範囲は両端を含む。
 */
export function judgeProperValue(
  criteria: PathwayProperCriteria | null,
  spec: NursingObservationInputSpec,
  input: [string, string],
): Achievement | null {
  if (!criteria) return null;
  const [a] = input;
  if (criteria.kind === "values") {
    if (spec.kind !== "enum" && spec.kind !== "text") return null;
    const value = a.trim();
    return value ? (criteria.values.includes(value) ? "1" : "2") : null;
  }
  if (spec.kind !== "number" && spec.kind !== "text") return null;
  const value = numberOf(a);
  if (value === null) return null;
  const ok = (criteria.low === null || value >= criteria.low) && (criteria.high === null || value <= criteria.high);
  return ok ? "1" : "2";
}

export function judgeAssessment(
  assessment: Pick<PathwayAssessmentRecord, "properCriteria">,
  spec: NursingObservationInputSpec,
  input: [string, string] | undefined,
): Achievement | null {
  return judgeProperValue(assessment.properCriteria, spec, input ?? ["", ""]);
}

/**
 * 観察項目の判定からアウトカムの達成状態を提案する。1 つでも未達成なら未達成、基準のある観察項目が
 * 全部そろって達成なら達成、それ以外(基準が無い・値が足りない)は提案しない(空)。確定は人がする。
 */
export function proposeAchievement(
  unit: PathwayOatUnitRecord,
  specs: Map<string, NursingObservationInputSpec>,
  results: Map<string, [string, string]>,
): Achievement | "" {
  let judged = 0;
  let pending = 0;
  for (const assessment of unit.assessments) {
    if (!assessment.properCriteria) continue;
    const status = judgeAssessment(assessment, specs.get(assessment.id) ?? { kind: "text" }, results.get(assessment.id));
    if (status === "2") return "2";
    if (status === "1") judged += 1;
    else pending += 1;
  }
  return judged > 0 && pending === 0 ? "1" : "";
}

export function resultValueLabel(observation: fhir4.Observation | undefined): string {
  return observation ? nursingObservationValueLabel(observation) : "";
}

// ---- 入力値 ----

export interface PathwayEvaluationValues {
  achievement: Achievement | "";
  /** 記載形式。切り替えても両方の入力は state に残し、保存するのは選んでいる方だけ。 */
  mode: EvaluationMode;
  soap: Record<"S" | "O" | "A" | "P", string>;
  /** 自由記載(総合評価)。 */
  freeText: string;
  /** 記載欄ごとのテンプレート紐付け。 */
  templates: Record<EvaluationField, TemplateBinding | null>;
  comment: string;
  /** 観察項目 CarePlan の id → 入力値(数値・文字・列挙は [値, ""]、2 値と血圧は [1 つ目, 2 つ目])。 */
  results: Map<string, [string, string]>;
  /** タスク Procedure の id → 実施したか。 */
  tasksDone: Map<string, boolean>;
  recordedAt: string;
}

/** 表現タイプ(看護観察に結んだ観察項目はマスタから、それ以外は文字)。 */
export function assessmentInputSpec(
  manageNo: string,
  masters: Map<string, NursingObservation> | undefined,
): NursingObservationInputSpec {
  return nursingObservationInputSpec(manageNo ? masters?.get(manageNo) : undefined);
}

/** 保存済みの実績 Observation を入力値に戻す。 */
export function resultInputOf(observation: fhir4.Observation | undefined): [string, string] {
  if (!observation) return ["", ""];
  if (observation.valueQuantity?.value !== undefined) return [String(observation.valueQuantity.value), ""];
  if (observation.valueString !== undefined) return [observation.valueString, ""];
  const concept = observation.valueCodeableConcept;
  if (concept) return [concept.text ?? concept.coding?.[0]?.display ?? "", ""];
  const components = (observation.component ?? []).filter((c) => c.valueQuantity?.value !== undefined);
  if (components.length >= 2) {
    return [String(components[0].valueQuantity?.value ?? ""), String(components[1].valueQuantity?.value ?? "")];
  }
  return ["", ""];
}

// ---- 実績値の候補(経過表) ----

const BLOOD_PRESSURE_CODE = "85354-9";
const SYSTOLIC_CODE = "8480-6";
const DIASTOLIC_CODE = "8462-4";

export interface AssessmentCandidate {
  values: [string, string];
  /** 「37.2℃(14:00)」。 */
  label: string;
}

function hasCoding(concept: fhir4.CodeableConcept | undefined, system: string, code: string): boolean {
  return Boolean(concept?.coding?.some((c) => c.system === system && c.code === code));
}

/**
 * 看護観察に結んだ観察項目の、その日の経過表の値(最後に記録したもの)。［決定］バイタル(体温・脈拍・SpO2・
 * 血圧など LOINC を持つもの)は手入力のバイタルと看護観察の記録のどちらからも読み、それ以外の看護観察は
 * 同じ管理番号の記録から読む。パスの実績(自分自身)は候補にしない。候補が無ければ null。
 */
export function assessmentCandidate(
  manageNo: string,
  date: string,
  observations: fhir4.Observation[],
): AssessmentCandidate | null {
  if (!manageNo || !date) return null;
  const vital = nursingVitalCodeOf(manageNo);
  const matches = observations
    .filter((o) => !isPathwayObservation(o) && o.status !== "entered-in-error")
    .filter((o) => localDay(o.effectiveDateTime) === date)
    .filter((o) => {
      if (hasCoding(o.code, NURSING_OBSERVATION_CODE_SYSTEM, manageNo)) return true;
      if (vital?.kind === "measure") return hasCoding(o.code, LOINC_SYSTEM, vital.code);
      if (vital?.kind === "bp") return hasCoding(o.code, LOINC_SYSTEM, BLOOD_PRESSURE_CODE);
      return false;
    })
    .sort((a, b) => (a.effectiveDateTime ?? "").localeCompare(b.effectiveDateTime ?? ""));
  const latest = matches.at(-1);
  if (!latest) return null;
  const time = (latest.effectiveDateTime ?? "").slice(11, 16);
  const suffix = time ? `(${time})` : "";

  if (vital?.kind === "bp") {
    const part = (code: string) =>
      latest.component?.find((c) => hasCoding(c.code, LOINC_SYSTEM, code))?.valueQuantity?.value;
    const systolic = part(SYSTOLIC_CODE);
    const diastolic = part(DIASTOLIC_CODE);
    if (vital.part === "systolic" && systolic !== undefined) return { values: [String(systolic), ""], label: `${systolic}mmHg${suffix}` };
    if (vital.part === "diastolic" && diastolic !== undefined) return { values: [String(diastolic), ""], label: `${diastolic}mmHg${suffix}` };
    if (vital.part === "both" && systolic !== undefined && diastolic !== undefined) {
      return { values: [String(systolic), String(diastolic)], label: `${systolic}/${diastolic}mmHg${suffix}` };
    }
    return null;
  }
  if (latest.valueQuantity?.value !== undefined) {
    const unit = latest.valueQuantity.unit ?? (vital?.kind === "measure" ? vital.unit : "");
    return { values: [String(latest.valueQuantity.value), ""], label: `${latest.valueQuantity.value}${unit}${suffix}` };
  }
  const text = latest.valueString ?? latest.valueCodeableConcept?.text ?? latest.valueCodeableConcept?.coding?.[0]?.display;
  return text ? { values: [text, ""], label: `${text}${suffix}` } : null;
}

export function evaluationValuesOf(
  unit: PathwayOatUnitRecord,
  state: PathwayEvaluationState | null,
): PathwayEvaluationValues {
  const evaluation = state?.units.get(unit.id);
  const results = new Map<string, [string, string]>();
  const tasksDone = new Map<string, boolean>();
  for (const assessment of unit.assessments) {
    results.set(assessment.id, resultInputOf(state?.results.get(assessment.id)));
    for (const task of assessment.tasks) tasksDone.set(task.id, task.done);
  }
  return {
    achievement: evaluation?.achievement ?? "",
    mode: evaluation?.mode ?? "soap",
    soap: { ...(evaluation?.soap ?? { S: "", O: "", A: "", P: "" }) },
    freeText: evaluation?.freeText ?? "",
    templates: { ...emptyTemplates(), ...(evaluation?.templates ?? {}) },
    comment: evaluation?.comment ?? "",
    results,
    tasksDone,
    // 記録は毎回新しい 1 件なので、日時は前の記録を引き継がず今にする。
    recordedAt: nowFhirDateTime(),
  };
}

function numberOf(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** 表現タイプごとの Observation の値。入っていなければ null(その観察項目は記録しない)。 */
export function resultValue(
  spec: NursingObservationInputSpec,
  input: [string, string],
): Partial<fhir4.Observation> | null {
  const [a, b] = input;
  switch (spec.kind) {
    case "number": {
      const value = numberOf(a);
      return value === null ? null : { valueQuantity: { value, ...(spec.unit ? { unit: spec.unit } : {}) } };
    }
    case "enum": {
      if (!a) return null;
      const index = spec.options.indexOf(a);
      const concept: fhir4.CodeableConcept = { text: a };
      if (spec.resultGroupCode && index >= 0) {
        concept.coding = [
          {
            system: NURSING_OBSERVATION_RESULT_SYSTEM,
            code: `${spec.resultGroupCode}-${String(index + 1).padStart(2, "0")}`,
            display: a,
          },
        ];
      }
      return { valueCodeableConcept: concept };
    }
    case "pair": {
      const na = numberOf(a);
      const nb = numberOf(b);
      if (na === null || nb === null) return null;
      return {
        component: [
          { code: { text: spec.labels[0] }, valueQuantity: { value: na, ...(spec.units[0] ? { unit: spec.units[0] } : {}) } },
          { code: { text: spec.labels[1] }, valueQuantity: { value: nb, ...(spec.units[1] ? { unit: spec.units[1] } : {}) } },
        ],
      };
    }
    case "bp": {
      const na = numberOf(a);
      const nb = numberOf(b);
      return na === null || nb === null ? null : { component: buildBloodPressureComponents(na, nb) };
    }
    default:
      return a.trim() ? { valueString: a.trim() } : null;
  }
}

// ---- 保存 ----

export interface PathwayEvaluationContext {
  patientId: string;
  unit: PathwayOatUnitRecord;
  unitCarePlan: fhir4.CarePlan;
  /** 観察項目 CarePlan の id → 表現タイプ。 */
  specs: Map<string, NursingObservationInputSpec>;
  /** タスク Procedure の id → 保存済みの Procedure(status と実施日時を書き換える)。 */
  procedures: Map<string, fhir4.Procedure>;
  /** 木に含めた Goal(id → Goal)。観察項目の適正値の Goal に達成状態を書くのに使う。 */
  goals?: Map<string, fhir4.Goal>;
  existing: PathwayEvaluationState | null;
  performer: { practitionerId: string; display: string } | null;
  /** 記録した診療科。評価の Observation に入れ、カルテのカードに出す。 */
  department?: DepartmentRef;
  /** バリアンスの通知に要る情報。渡さなければ通知を作らない(指示簿のタスクの記録など)。 */
  variance?: PathwayVarianceNotice | null;
}

function put<T extends fhir4.Resource>(resource: T): fhir4.BundleEntry {
  return { resource, request: { method: "PUT", url: `${resource.resourceType}/${resource.id}` } };
}

function performerRef(performer: PathwayEvaluationContext["performer"]): fhir4.Reference[] {
  return performer
    ? [{ reference: `Practitioner/${performer.practitionerId}`, display: performer.display || undefined }]
    : [];
}

/**
 * 1 病日 × 1 OAT ユニットの評価を 1 transaction にまとめる。評価 Observation は記録のたびに新しく POST し
 * (識別子の末尾が記録番号)、Goal は初回に POST して OAT ユニットの CarePlan に goal を足し(PUT)、以後は
 * 最新の達成状態と評価への参照を PUT で重ねる。観察項目の実績は値が入っていて前回と変わったものだけ POST
 * (消しても前の記録は残す)。タスクは状態が変わったものだけ PUT。
 */
export function buildPathwayEvaluationBundle(
  ctx: PathwayEvaluationContext,
  values: PathwayEvaluationValues,
): fhir4.Bundle {
  const { patientId, unit, unitCarePlan } = ctx;
  const existing = ctx.existing?.units.get(unit.id);
  const entry: fhir4.BundleEntry[] = [];
  const subject = { reference: `Patient/${patientId}` };
  const performer = performerRef(ctx.performer);
  const recordedAt = values.recordedAt || nowFhirDateTime();
  const recordNo = nextRecordNo(unit, ctx.existing);

  // 記載欄(S/O/A/P か自由記載)。選んでいる形式のぶんだけ書く。
  const written: { field: EvaluationField; code: string; text: string }[] =
    values.mode === "free"
      ? [{ field: "free" as EvaluationField, code: FREE_TEXT_CODE, text: values.freeText.trim() }].filter((x) => x.text)
      : SOAP_ITEMS.map((i) => ({ field: i.code as EvaluationField, code: i.code, text: values.soap[i.code].trim() })).filter(
          (x) => x.text,
        );

  // 評価(達成状態・記載・コメント)。どれか 1 つでも入っていれば記録する。
  const hasEvaluation = Boolean(values.achievement) || written.length > 0 || Boolean(values.comment.trim());

  // テンプレートから書いた欄の回答(QuestionnaireResponse)を同じ transaction に積む。
  // 先に単独で保存すると「評価を保存しなかったときに回答だけが残る」ため(オーダーと同じ作り)。
  // 前の記録の回答は書き換えも削除もしない(前の評価がそれを指している)。再編集したら新しい回答を POST し、
  // 再編集していなければ同じ回答を新しい評価からも指す。
  const templateRefs = new Map<EvaluationField, string>();
  if (hasEvaluation) {
    for (const item of written) {
      const binding = values.templates[item.field];
      if (!binding) continue;
      const { responseId, draft } = binding;
      if (!draft) {
        if (responseId) templateRefs.set(item.field, `QuestionnaireResponse/${responseId}`);
        continue;
      }
      const reference = `urn:uuid:${crypto.randomUUID()}`;
      const { id: _previousId, ...response } = draft.response;
      entry.push({ fullUrl: reference, resource: response, request: { method: "POST", url: "QuestionnaireResponse" } });
      entry.push(...draft.imageEntries);
      templateRefs.set(item.field, reference);
    }
  }

  let evaluationRef: string | null = existing?.observation?.id ? `Observation/${existing.observation.id}` : null;
  if (hasEvaluation) {
    const observation: fhir4.Observation = {
      resourceType: "Observation",
      identifier: [{ system: PATHWAY_EVALUATION_ID_SYSTEM, value: `${unit.unitId}.${recordNo}` }],
      status: "final",
      category: [pathwayObservationCategory()],
      code: { coding: [{ system: EVALUATION_ITEM_SYSTEM, code: "judgement", display: "評価" }], text: unit.name },
      subject,
      effectiveDateTime: recordedAt,
      performer,
      basedOn: [{ reference: `CarePlan/${unit.id}` }],
      ...(values.achievement
        ? {
            valueCodeableConcept: {
              coding: [{ system: ACHIEVEMENT_SYSTEM, code: values.achievement, display: achievementLabel(values.achievement) }],
            },
          }
        : {}),
      component: written.map((item) => {
        const reference = templateRefs.get(item.field) ?? "";
        return {
          code: { coding: [{ system: EVALUATION_ITEM_SYSTEM, code: item.code }] },
          valueString: item.text,
          ...(reference
            ? {
                extension: [
                  { url: PATHWAY_EVALUATION_TEMPLATE_EXT_URL, valueReference: { reference } },
                ],
              }
            : {}),
        };
      }),
      note: values.comment.trim() ? [{ text: values.comment.trim(), time: recordedAt }] : undefined,
    };
    if (ctx.department?.departmentId) {
      observation.extension = [departmentExtension(ctx.department.departmentId, ctx.department.departmentName)];
    }
    if (observation.component?.length === 0) delete observation.component;
    if (!observation.note) delete observation.note;
    const url = `urn:uuid:${crypto.randomUUID()}`;
    evaluationRef = url;
    entry.push({ fullUrl: url, resource: observation, request: { method: "POST", url: "Observation" } });

    const goal: fhir4.Goal = {
      ...(existing?.goal ?? {}),
      resourceType: "Goal",
      identifier: [{ system: PATHWAY_OUTCOME_GOAL_ID_SYSTEM, value: unit.unitId }],
      // 評価が済んだアウトカムは completed、未評価のままなら active(ePath: 設定できなければ completed)。
      lifecycleStatus: values.achievement && values.achievement !== "3" ? "completed" : "active",
      ...(values.achievement
        ? {
            achievementStatus: {
              coding: [{ system: ACHIEVEMENT_SYSTEM, code: values.achievement, display: achievementLabel(values.achievement) }],
            },
          }
        : {}),
      description: { text: unit.name },
      subject,
      statusDate: recordedAt.slice(0, 10),
      // 評価の記録を全部指す(末尾が最新)。
      outcomeReference: [
        ...(existing?.goal?.outcomeReference ?? []).filter((ref) => ref.reference !== evaluationRef),
        ...(evaluationRef ? [{ reference: evaluationRef }] : []),
      ],
    };
    if (goal.outcomeReference?.length === 0) delete goal.outcomeReference;
    if (!values.achievement) delete goal.achievementStatus;
    if (existing?.goal?.id) {
      entry.push(put(goal));
    } else {
      const goalUrl = `urn:uuid:${crypto.randomUUID()}`;
      entry.push({ fullUrl: goalUrl, resource: goal, request: { method: "POST", url: "Goal" } });
      // OAT ユニットの CarePlan から Goal を辿れるようにする(初回だけ)。
      entry.push(put({ ...unitCarePlan, goal: [...(unitCarePlan.goal ?? []), { reference: goalUrl }] }));
    }
  }

  // 重要アウトカムの未達成は主治医に通知する(未達成でなくなったら未対応の通知を取り下げる)。
  if (ctx.variance) {
    entry.push(
      ...pathwayVarianceTaskEntries(
        ctx.variance,
        unit,
        hasEvaluation ? values.achievement : "",
        existing?.achievement ?? "",
        evaluationRef,
      ),
    );
  }

  // 観察項目の実績。値が入っていて前回の最新と違うものだけ新しく記録する(空にしても前の記録は消さない)。
  for (const assessment of unit.assessments) {
    if (!assessment.name) continue;
    const spec = ctx.specs.get(assessment.id) ?? { kind: "text" };
    const input = values.results.get(assessment.id) ?? ["", ""];
    const value = resultValue(spec, input);
    if (!value) continue;
    const previous = resultInputOf(ctx.existing?.results.get(assessment.id));
    if (previous[0] === input[0].trim() && previous[1] === input[1].trim()) continue;
    const observation: fhir4.Observation = {
      resourceType: "Observation",
      identifier: [{ system: PATHWAY_RESULT_ID_SYSTEM, value: `${unit.unitId}.${assessment.assessmentKey}.${recordNo}` }],
      status: "final",
      category: [pathwayObservationCategory()],
      code: { ...(assessment.codings.length > 0 ? { coding: assessment.codings } : {}), text: assessment.name },
      subject,
      effectiveDateTime: recordedAt,
      performer,
      basedOn: [{ reference: `CarePlan/${assessment.id}` }],
      ...value,
    };
    entry.push({ resource: observation, request: { method: "POST", url: "Observation" } });
  }

  // 観察項目ごとの達成状態(実績値を基準に当てた結果)。適正値の Goal に書き、変わったときだけ PUT。
  // 判定できない(基準や値が無い)ときは消す(= 未評価)。
  for (const assessment of unit.assessments) {
    const goal = assessment.properGoalId ? ctx.goals?.get(assessment.properGoalId) : undefined;
    if (!goal?.id) continue;
    const spec = ctx.specs.get(assessment.id) ?? { kind: "text" };
    const judged = resultValue(spec, values.results.get(assessment.id) ?? ["", ""])
      ? judgeAssessment(assessment, spec, values.results.get(assessment.id))
      : null;
    const previous = ctx.existing?.assessments.get(assessment.id) ?? null;
    if (judged === previous) continue;
    const next: fhir4.Goal = { ...goal, statusDate: recordedAt.slice(0, 10) };
    if (judged) {
      next.achievementStatus = {
        coding: [{ system: ACHIEVEMENT_SYSTEM, code: judged, display: achievementLabel(judged) }],
      };
    } else {
      delete next.achievementStatus;
      delete next.statusDate;
    }
    entry.push(put(next));
  }

  // タスクの実施 / 未実施。
  for (const assessment of unit.assessments) {
    for (const task of assessment.tasks) {
      const done = values.tasksDone.get(task.id) ?? task.done;
      if (done === task.done) continue;
      const procedure = ctx.procedures.get(task.id);
      if (!procedure) continue;
      entry.push(put(taskProcedureUpdate(procedure, done, recordedAt, ctx.performer)));
    }
  }

  return { resourceType: "Bundle", type: "transaction", entry };
}

export interface PathwayDayAssessmentContext {
  patientId: string;
  event: PathwayEventRecord;
  existing: DayAssessment | undefined;
  performer: PathwayEvaluationContext["performer"];
  department?: DepartmentRef;
}

/**
 * 病日ごとの医師の総合評価(ePath の compAssessment、病日に 1 件)。本文が入っていれば Observation を
 * POST / PUT(上書き)、空にしたら DELETE。病日の CarePlan には触れない(読みは basedOn の逆引きで足りる)。
 * 変わっていなければ entry は空。
 */
export function buildPathwayDayAssessmentBundle(
  ctx: PathwayDayAssessmentContext,
  text: string,
  recordedAt: string,
): fhir4.Bundle {
  const { event, existing } = ctx;
  const body = text.trim();
  const entry: fhir4.BundleEntry[] = [];
  if (!body) {
    if (existing?.observation.id) entry.push({ request: { method: "DELETE", url: `Observation/${existing.observation.id}` } });
    return { resourceType: "Bundle", type: "transaction", entry };
  }
  if (existing && existing.text.trim() === body) return { resourceType: "Bundle", type: "transaction", entry };
  const label = `病日 ${event.elapsedDays} ${eventDayStepLabel(event.elapsedDays, event.title, event.pathStep, event.pathStepName)}`;
  const observation: fhir4.Observation = {
    ...(existing?.observation ?? {}),
    resourceType: "Observation",
    identifier: [{ system: PATHWAY_DAY_ASSESSMENT_ID_SYSTEM, value: event.eventId || event.id }],
    status: "final",
    category: [pathwayObservationCategory()],
    code: { coding: [{ system: EVALUATION_ITEM_SYSTEM, code: FREE_TEXT_CODE, display: "総合評価" }], text: label },
    subject: { reference: `Patient/${ctx.patientId}` },
    effectiveDateTime: recordedAt || nowFhirDateTime(),
    performer: performerRef(ctx.performer),
    basedOn: [{ reference: `CarePlan/${event.id}` }],
    valueString: body,
  };
  if (!existing && ctx.department?.departmentId) {
    observation.extension = [departmentExtension(ctx.department.departmentId, ctx.department.departmentName)];
  }
  if (existing?.observation.id) entry.push(put(observation));
  else entry.push({ resource: observation, request: { method: "POST", url: "Observation" } });
  return { resourceType: "Bundle", type: "transaction", entry };
}

/** タスク Procedure を実施済(completed + 実施日時 + 実施者)か未実施(preparation)に書き換えたもの。 */
function taskProcedureUpdate(
  procedure: fhir4.Procedure,
  done: boolean,
  recordedAt: string,
  performer: PathwayEvaluationContext["performer"],
): fhir4.Procedure {
  const actors = performerRef(performer);
  const next: fhir4.Procedure = done
    ? {
        ...procedure,
        status: "completed",
        performedDateTime: recordedAt,
        ...(actors.length > 0 ? { performer: actors.map((actor) => ({ actor })) } : {}),
      }
    : { ...procedure, status: "preparation" };
  if (!done) {
    delete next.performedDateTime;
    delete next.performer;
  }
  return next;
}

/**
 * タスク 1 件だけの実施 / 未実施の記録(パスシートのタスクのセルから開く右ペイン)。
 * 評価(Goal・Observation)には触れない。
 */
export function buildPathwayTaskBundle(
  procedure: fhir4.Procedure,
  done: boolean,
  recordedAt: string,
  performer: PathwayEvaluationContext["performer"],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [put(taskProcedureUpdate(procedure, done, recordedAt || nowFhirDateTime(), performer))],
  };
}
