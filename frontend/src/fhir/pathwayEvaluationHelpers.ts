import type { NursingObservation } from "../api/masterClient";
import type { TemplateBinding } from "./questionnaireResponseHelpers";
import { nowFhirDateTime } from "../lib/dates";
import {
  nursingObservationInputSpec,
  nursingObservationValueLabel,
  type NursingObservationInputSpec,
} from "./nursingPerformHelpers";
import {
  PATHWAY_MARKER_CODE,
  PATHWAY_MARKER_SYSTEM,
  type PathwayOatUnitRecord,
} from "./pathwayApplyHelpers";
import { NURSING_OBSERVATION_RESULT_SYSTEM, nursingVitalCodeOf } from "./nursingPerformHelpers";
import { NURSING_OBSERVATION_CODE_SYSTEM } from "./nursingOrderHelpers";
import { buildBloodPressureComponents } from "./vitalHelpers";

// クリニカルパスの日次評価(1 病日 × 1 OAT ユニット)の FHIR 構造。ePath の適用後パスデータに倣う。
// React に依存しない。設計は docs/clinical-pathway-design.md §7.4。
//
//   Goal(アウトカム)            identifier outcome-goal-id、achievementStatus = 1 達成 / 2 未達成 / 3 未評価、
//                              outcomeReference → 評価の Observation。CarePlan(OAT ユニット).goal がこれを指す
//   Observation(評価)           code = judgement、value = 達成状態、component = S/O/A/P、basedOn → CarePlan(OAT ユニット)
//   Observation(観察項目の実績) code = 観察項目のコード、value = 実績値、basedOn → CarePlan(観察項目)
//   Procedure(タスク)           status = completed(実施)/ preparation(未実施)、performedDateTime、performer
//
// ［決定］評価・実績の Observation は Goal に contained せず独立のリソースにする(検索で読める。
// EP12 出力で contained に畳む)。category の先頭にパスの印を置き、患者 + category の 1 回の検索で
// 全部引く(上流は category の先頭しか索引しない)。

const ID_SYSTEM_BASE = "http://e-path.jp/fhir/ePath/IdSystem";
export const PATHWAY_OUTCOME_GOAL_ID_SYSTEM = `${ID_SYSTEM_BASE}/outcome-goal-id`;
export const PATHWAY_EVALUATION_ID_SYSTEM = `${ID_SYSTEM_BASE}/observation-evaluation-id`;
export const PATHWAY_RESULT_ID_SYSTEM = `${ID_SYSTEM_BASE}/observation-result-id`;

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

export interface UnitEvaluation {
  goal: fhir4.Goal | null;
  observation: fhir4.Observation | null;
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

export interface PathwayEvaluationState {
  /** OAT ユニット CarePlan の id → 評価。 */
  units: Map<string, UnitEvaluation>;
  /** 観察項目 CarePlan の id → 実績の Observation。 */
  results: Map<string, fhir4.Observation>;
}

/**
 * 患者のパス関連 Observation(評価と実績)と、木に含めた Goal から評価の状態を組む。
 * Goal は CarePlan(OAT ユニット).goal で結ばれるので、unit → goal は CarePlan 側から引く。
 */
export function buildEvaluationState(
  observations: fhir4.Observation[],
  goals: Map<string, fhir4.Goal>,
  unitCarePlans: fhir4.CarePlan[],
): PathwayEvaluationState {
  const units = new Map<string, UnitEvaluation>();
  const results = new Map<string, fhir4.Observation>();
  const evaluations = new Map<string, fhir4.Observation>();
  for (const observation of observations) {
    if (!isPathwayObservation(observation)) continue;
    const isEvaluation = observation.code?.coding?.some(
      (c) => c.system === EVALUATION_ITEM_SYSTEM && c.code === "judgement",
    );
    const target = basedOnId(observation);
    if (!target) continue;
    (isEvaluation ? evaluations : results).set(target, observation);
  }
  for (const unit of unitCarePlans) {
    if (!unit.id) continue;
    const goalId = unit.goal?.[0]?.reference?.split("/").pop();
    const goal = goalId ? (goals.get(goalId) ?? null) : null;
    const observation = evaluations.get(unit.id) ?? null;
    const achievement = (goal?.achievementStatus?.coding?.find((c) => c.system === ACHIEVEMENT_SYSTEM)?.code ??
      "") as Achievement | "";
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
    units.set(unit.id, {
      goal,
      observation,
      achievement,
      mode,
      soap,
      freeText,
      templates,
      comment: observation?.note?.[0]?.text ?? "",
      recordedAt: observation?.effectiveDateTime ?? "",
      performerName: observation?.performer?.[0]?.display ?? "",
    });
  }
  return { units, results };
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

const LOINC_SYSTEM = "http://loinc.org";
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
    .filter((o) => (o.effectiveDateTime ?? "").slice(0, 10) === date)
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
    recordedAt: evaluation?.recordedAt || nowFhirDateTime(),
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
  existing: PathwayEvaluationState | null;
  performer: { practitionerId: string; display: string } | null;
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
 * 1 病日 × 1 OAT ユニットの評価を 1 transaction にまとめる。初回は Goal と評価 Observation を
 * POST し、OAT ユニットの CarePlan に goal を足す(PUT)。2 回目以降は同じ id へ PUT。
 * 観察項目の実績は値が入っているものだけ(消したら削除)。タスクは状態が変わったものだけ PUT。
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
  const templateRefs = new Map<EvaluationField, string>();
  const keptResponseIds = new Set<string>();
  if (hasEvaluation) {
    for (const item of written) {
      const binding = values.templates[item.field];
      if (!binding) continue;
      const { responseId, draft } = binding;
      if (!draft) {
        // 再編集していない保存済みの回答 → 参照だけ引き継ぐ。
        if (responseId) {
          templateRefs.set(item.field, `QuestionnaireResponse/${responseId}`);
          keptResponseIds.add(responseId);
        }
        continue;
      }
      const reference = responseId
        ? `QuestionnaireResponse/${responseId}`
        : `urn:uuid:${crypto.randomUUID()}`;
      if (responseId) {
        entry.push({ resource: { ...draft.response, id: responseId }, request: { method: "PUT", url: reference } });
        keptResponseIds.add(responseId);
      } else {
        entry.push({ fullUrl: reference, resource: draft.response, request: { method: "POST", url: "QuestionnaireResponse" } });
      }
      entry.push(...draft.imageEntries);
      templateRefs.set(item.field, reference);
    }
  }

  // 参照が外れた回答(テンプレートを解除した・形式を切り替えた)は一緒に消す。
  for (const component of existing?.observation?.component ?? []) {
    const previous = templateRefOf(component).split("/").pop() ?? "";
    if (previous && !keptResponseIds.has(previous)) {
      entry.push({ request: { method: "DELETE", url: `QuestionnaireResponse/${previous}` } });
    }
  }
  let evaluationRef: string | null = existing?.observation?.id ? `Observation/${existing.observation.id}` : null;
  if (hasEvaluation) {
    const observation: fhir4.Observation = {
      ...(existing?.observation ?? {}),
      resourceType: "Observation",
      identifier: [{ system: PATHWAY_EVALUATION_ID_SYSTEM, value: unit.unitId }],
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
    if (!values.achievement) delete observation.valueCodeableConcept;
    if (observation.component?.length === 0) delete observation.component;
    if (!observation.note) delete observation.note;
    if (existing?.observation?.id) {
      entry.push(put(observation));
    } else {
      const url = `urn:uuid:${crypto.randomUUID()}`;
      evaluationRef = url;
      entry.push({ fullUrl: url, resource: observation, request: { method: "POST", url: "Observation" } });
    }

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
      ...(evaluationRef ? { outcomeReference: [{ reference: evaluationRef }] } : {}),
    };
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

  // 観察項目の実績。
  for (const assessment of unit.assessments) {
    if (!assessment.name) continue;
    const spec = ctx.specs.get(assessment.id) ?? { kind: "text" };
    const previous = ctx.existing?.results.get(assessment.id);
    const value = resultValue(spec, values.results.get(assessment.id) ?? ["", ""]);
    if (!value) {
      if (previous?.id) entry.push({ request: { method: "DELETE", url: `Observation/${previous.id}` } });
      continue;
    }
    const observation: fhir4.Observation = {
      ...(previous ?? {}),
      resourceType: "Observation",
      identifier: [{ system: PATHWAY_RESULT_ID_SYSTEM, value: `${unit.unitId}.${assessment.assessmentKey}` }],
      status: "final",
      category: [pathwayObservationCategory()],
      code: { ...(assessment.codings.length > 0 ? { coding: assessment.codings } : {}), text: assessment.name },
      subject,
      effectiveDateTime: recordedAt,
      performer,
      basedOn: [{ reference: `CarePlan/${assessment.id}` }],
      ...value,
    };
    // 表現タイプが変わったときに前の値の形が残らないようにする。
    for (const key of ["valueQuantity", "valueString", "valueCodeableConcept", "component"] as const) {
      if (!(key in value)) delete (observation as unknown as Record<string, unknown>)[key];
    }
    if (previous?.id) entry.push(put(observation));
    else entry.push({ resource: observation, request: { method: "POST", url: "Observation" } });
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
