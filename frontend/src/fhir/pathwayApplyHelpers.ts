import type {
  PathwayAssessment,
  PathwayDetail,
  PathwayEvent,
  PathwayOatUnit,
  PathwayTask,
} from "../api/masterClient";
import { addDays } from "../lib/dates";
import { DEFAULT_MEAL_TIMING, previousMealPoint, type MealOrderFormValues, type MealTiming } from "./mealOrderHelpers";
import { NURSING_OBSERVATION_CODE_SYSTEM, type NursingOrderFormValues } from "./nursingOrderHelpers";
import { isHeaderEntry } from "./provenanceHelpers";

// クリニカルパスの患者への適用(適用後パスデータ)の FHIR 構造。ePath(ePath R4 実装ガイド)の
// 適用後パスデータ(EP12)に倣い、1 回の適用を CarePlan の木で表す。
// React に依存しない。設計は docs/clinical-pathway-design.md。
//
//   CarePlan(適用)              partOf 無し = 木の根
//     └ CarePlan(病日)          partOf = [適用]
//         └ CarePlan(OAT ユニット) partOf = [適用, 病日]
//             └ CarePlan(観察項目)  partOf = [適用, 病日, OAT ユニット]
//                 └ Procedure(タスク) basedOn = [観察項目]
//
// ［決定］子孫は partOf に**祖先すべて**を並べる(ePath の identifier が祖先を連結するのと
// 同じ考え方)。こうすると適用を指す 1 回の検索(`part-of=CarePlan/{適用の id}`)で木全体が
// 引け、根だけは `part-of:missing=true` で引ける(上流の実装は fhir-server の README 参照)。
//
// ［決定］参照は **Procedure → 観察項目の一方向だけ**にする。ePath は観察項目側にも
// activity.outcomeReference でタスクを持たせるが、同じ transaction の中で相互参照に
// なるため書かない。EP12 出力のときに Procedure.basedOn から組み立て直す(第 3 段階)。

// ---- 識別子の体系(ePath) ----

const ID_SYSTEM_BASE = "http://e-path.jp/fhir/ePath/IdSystem";

export const PATHWAY_APPLY_ID_SYSTEM = `${ID_SYSTEM_BASE}/apply-id`;
export const PATHWAY_EVENT_ID_SYSTEM = `${ID_SYSTEM_BASE}/event-id`;
export const PATHWAY_OAT_UNIT_ID_SYSTEM = `${ID_SYSTEM_BASE}/oat-unit-id`;
export const PATHWAY_ASSESSMENT_ID_SYSTEM = `${ID_SYSTEM_BASE}/assessment-id`;
export const PATHWAY_TASK_ID_SYSTEM = `${ID_SYSTEM_BASE}/task-id`;
/** 観察項目の Goal(ePath の Goal AssessmentExecution)。値は観察項目の識別子と同じ。 */
export const PATHWAY_ASSESSMENT_GOAL_ID_SYSTEM = `${ID_SYSTEM_BASE}/assessment-goal-id`;

// ---- 拡張(ePath) ----

const EXT_BASE = "http://e-path.jp/fhir/ePath/StructureDefinition";

export const PATHWAY_EXT = {
  adaptiveCriteriaConfirmation: `${EXT_BASE}/EPathCarePlanAdaptiveCriteriaConfirmation`,
  adaptiveCriteriaText: `${EXT_BASE}/EPathCarePlanAdaptiveCriteriaText`,
  scheduledDays: `${EXT_BASE}/EPathCarePlanScheduledDays`,
  eventElapsedDays: `${EXT_BASE}/EPathCarePlanEventElapsedDays`,
  pathStep: `${EXT_BASE}/EPathCarePlanPathStep`,
  pathStepName: `${EXT_BASE}/EPathCarePlanPathStepName`,
  inpatientOutpatientType: `${EXT_BASE}/EPathCarePlanPathStepInpatientOutpatientType`,
  statusTypeWhenOccured: `${EXT_BASE}/EPathCarePlanStatusTypeWhenOccured`,
  criticalIndicator: `${EXT_BASE}/EPathCarePlanCriticalIndicator`,
  unplannedKind: `${EXT_BASE}/EPathCarePlanUnplannedKind`,
  repeatNo: `${EXT_BASE}/EPathCarePlanRepeatNo`,
  taskPlannedDateTime: `${EXT_BASE}/EPathProcedureTaskPlannedDateTime`,
} as const;

// 発生時パス状態区分。適用後パスデータは EP12。
const STATUS_TYPE_EP12 = "12";
// Y/N 区分(重要アウトカム・予定外)。
const YES = "Y";
const NO = "N";

// ---- コード体系(ePath / ローカル) ----

const CS_BASE = "http://e-path.jp/fhir/ePath/CodeSystem";

export const PATHWAY_CODE_SYSTEM = {
  bomOutcomeCategory: `${CS_BASE}/EPathBOMOutcomeCategoryCS`,
  bomOutcomeCode: `${CS_BASE}/EPathBOMOutcomeCodeCS`,
  localOutcomeCategory: `${CS_BASE}/EPathLocalOutcomeCategoryCS`,
  localOutcomeCode: `${CS_BASE}/EPathLocalOutcomeCodeCS`,
  bomAssessmentCategory: `${CS_BASE}/EPathBOMAssessmentCategoryCS`,
  bomAssessmentCode: `${CS_BASE}/EPathBOMAssessmentCodeCS`,
  localAssessmentCategory: `${CS_BASE}/EPathLocalAssessmentCategoryCS`,
  localAssessmentCode: `${CS_BASE}/EPathLocalAssessmentCodeCS`,
  assessmentCodeEmpty: `${CS_BASE}/EPathAssessmentCodeEmptyCS`,
  taskCategoryLv1: `${CS_BASE}/EPathTaskCategoryLv1CS`,
  taskCategoryLv2: `${CS_BASE}/EPathTaskCategoryLv2CS`,
  localTaskCode: `${CS_BASE}/EPathLocalTaskCodeCS`,
} as const;

/** 「タスクのみの観察項目」を表す固定コード(ePath)。観察項目の識別子にも使う。 */
export const EMPTY_ASSESSMENT_CODE = "ZZZZZZZZZZ";

// ［決定］どの階層の CarePlan かを category のローカルコードで示す。partOf の本数でも
// 導けるが、木を全部読まないと分からない。階層コードがあれば「この患者のパス適用一覧」
// (level=apply)も「この日の OAT ユニット」も 1 回の検索で引ける。
// EP12 出力のときはこのローカル体系を落とす。
export const PATHWAY_MARKER_SYSTEM = "http://fhir-client.local/CodeSystem/care-plan-type";
export const PATHWAY_MARKER_CODE = "clinical-pathway";
export const PATHWAY_LEVEL_SYSTEM = "http://fhir-client.local/CodeSystem/pathway-level";
// ［決定］定義の並び(display_order)をローカル拡張で持ち越す。CarePlan にも Procedure にも
// 並びを表す要素が無く、上流の id は uuid なので、無いとシートの行が定義と違う順になる。
// EP12 出力では落とす。
export const PATHWAY_DISPLAY_ORDER_EXT_URL = "http://fhir-client.local/StructureDefinition/pathway-display-order";

export type PathwayLevel = "apply" | "event" | "oat-unit" | "assessment";

// ---- オーダーの印(オーダー雛形から出したオーダー) ----

/** 1 回の適用で登録したオーダー群を束ねる識別子(ヘッダ ServiceRequest.identifier、値 = 適用 uuid)。 */
export const PATHWAY_INSTANCE_SYSTEM = "http://fhir-client.local/Identifier/pathway-instance";
/** どのパスから出したか(ヘッダ ServiceRequest の拡張、valueCoding.code = パスコード)。 */
export const PATHWAY_LOCAL_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/pathway";
export const PATHWAY_ORDER_EXT_URL = "http://fhir-client.local/StructureDefinition/pathway-order";

/**
 * 登録するオーダーのヘッダ(basedOn を持たない ServiceRequest)に、どのパスの適用から
 * 出したかの印を焼く(オーダーセットの stampOrderSetInstance と同型)。requisition は
 * 空いているときだけ入れる(注射の連日展開が先に使う)。
 */
export function stampPathwayOrders(
  bundle: fhir4.Bundle,
  pathway: { code: string; name: string },
  applyKey: string,
): fhir4.Bundle {
  const identifier: fhir4.Identifier = { system: PATHWAY_INSTANCE_SYSTEM, value: applyKey };
  const extension: fhir4.Extension = {
    url: PATHWAY_ORDER_EXT_URL,
    valueCoding: { system: PATHWAY_LOCAL_CODE_SYSTEM, code: pathway.code, display: pathway.name },
  };
  return {
    ...bundle,
    entry: (bundle.entry ?? []).map((entry) => {
      if (!isHeaderEntry(entry)) return entry;
      const sr = entry.resource;
      return {
        ...entry,
        resource: {
          ...sr,
          identifier: [...(sr.identifier ?? []), identifier],
          extension: [...(sr.extension ?? []), extension],
          requisition: sr.requisition ?? identifier,
        },
      };
    }),
  };
}

/** オーダーがパスの適用から出たものなら、そのパスのコードと名前。 */
export function pathwayOf(sr: fhir4.ServiceRequest): { code: string; name: string } | null {
  const coding = sr.extension?.find((e) => e.url === PATHWAY_ORDER_EXT_URL)?.valueCoding;
  if (!coding?.code) return null;
  return { code: coding.code, name: coding.display ?? "" };
}

/** オーダー雛形の transaction Bundle から、ヘッダ(basedOn を持たない ServiceRequest)の fullUrl。 */
export function orderHeaderUrlsOf(bundle: fhir4.Bundle): string[] {
  return (bundle.entry ?? [])
    .filter(isHeaderEntry)
    .map((entry) => entry.fullUrl)
    .filter((url): url is string => Boolean(url));
}

/** パス定義(backend のマスタ)を指す URI。レジメンと同じ形。 */
export function pathwayInstantiatesUri(pathwayCode: string): string {
  return `http://fhir-client.local/pathway/${pathwayCode}`;
}

// ---- 識別子の組み立て ----

/** ePath の action.id(病日[-パスステップ])。 */
export function eventKeyOf(elapsedDays: number, pathStep: number): string {
  return pathStep <= 1 ? String(elapsedDays) : `${elapsedDays}-${pathStep}`;
}

/**
 * 適用 1 件の識別子の前半(医療機関コード.適用識別子)。以降の階層はこれにピリオドで
 * 病日・OAT ユニット・観察項目・タスクの識別子を連ねる(ePath の規則)。
 */
export function applyIdValue(institutionNumber: string, applyKey: string): string {
  return `${institutionNumber}.${applyKey}`;
}

export function eventIdValue(applyId: string, elapsedDays: number, pathStep: number): string {
  return `${applyId}.${eventKeyOf(elapsedDays, pathStep)}`;
}

/** リピート番号は同じアウトカムを 1 病日で複数回評価するときだけ付ける(1 回目は付けない)。 */
export function oatUnitIdValue(eventId: string, unitKey: string, repeatNo = 1): string {
  return repeatNo > 1 ? `${eventId}.${unitKey}-${repeatNo}` : `${eventId}.${unitKey}`;
}

export function assessmentIdValue(unitId: string, assessmentKey: string): string {
  return `${unitId}.${assessmentKey}`;
}

export function taskIdValue(assessmentId: string, taskKey: string): string {
  return `${assessmentId}.${taskKey}`;
}

// ---- 病日 → 実日付 ----

/**
 * 病日の実日付。入院日を 1、入院前日を -1 とし 0 は使わない(ePath と同じ数え方)ので、
 * 正の病日は 入院日 + (病日 - 1)、負の病日は 入院日 + 病日 になる。
 */
export function pathwayEventDate(admissionDate: string, elapsedDays: number): string {
  return addDays(admissionDate, elapsedDays > 0 ? elapsedDays - 1 : elapsedDays);
}

// ---- 適用の入力値 ----

export interface PathwayApplyInput {
  pathway: PathwayDetail;
  patientId: string;
  /** 入院 Encounter。病日の起点は入院日なので、外来パスでも受診の Encounter を渡す。 */
  encounterId?: string;
  /** 病日 1 の日付(入院日)。 */
  admissionDate: string;
  /** 自院の保険医療機関番号。識別子の先頭に入る。 */
  institutionNumber: string;
  /** 適応基準を確認したか。ePath の適応基準確認区分(0 未確認 / 1 確認)。 */
  adaptiveCriteriaConfirmed: boolean;
  /** 適用 1 件の識別子。省略すると採番する。 */
  applyKey?: string;
  /** パスが対象とする病名(Condition)への参照。適用画面で選んだものを渡す。 */
  conditionIds?: string[];
  /**
   * オーダー雛形から同じ transaction で登録するオーダーのヘッダ(pathwayTaskOrderKey → fullUrl)。
   * タスクの Procedure が basedOn でそのオーダーも指し、シートから実施の進み具合を辿れる。
   * 続きをまとめたオーダーは、受け持つ病日すべてのキーに同じ fullUrl が入る。
   */
  orderHeaderUrls?: Map<string, string[]>;
}

function markerCategory(level: PathwayLevel): fhir4.CodeableConcept {
  return {
    coding: [
      { system: PATHWAY_MARKER_SYSTEM, code: PATHWAY_MARKER_CODE },
      { system: PATHWAY_LEVEL_SYSTEM, code: level },
    ],
  };
}

function codingOf(
  system: string | undefined,
  code: string | null | undefined,
  display: string | null | undefined,
): fhir4.CodeableConcept | null {
  if (!system || !code) return null;
  return { coding: [{ system, code, ...(display ? { display } : {}) }] };
}

/** アウトカムの分類・コード(BOM かローカルか)を category に並べる。 */
function outcomeCategories(unit: PathwayOatUnit): fhir4.CodeableConcept[] {
  const bom = unit.code_system === "bom";
  const categorySystem = bom ? PATHWAY_CODE_SYSTEM.bomOutcomeCategory : PATHWAY_CODE_SYSTEM.localOutcomeCategory;
  const codeSystem = bom ? PATHWAY_CODE_SYSTEM.bomOutcomeCode : PATHWAY_CODE_SYSTEM.localOutcomeCode;
  return [
    // 区分(G 患者目標 / H 患者状態)は BOM の大分類。ローカルコードのパスでも意味は同じ。
    codingOf(unit.category ? PATHWAY_CODE_SYSTEM.bomOutcomeCategory : undefined, unit.category, null),
    unit.code ? codingOf(codeSystem, unit.code, unit.name) : null,
    // コード体系を選んでいないアウトカムは分類だけ(名称は title に入る)。
    unit.code_system && !unit.code ? codingOf(categorySystem, unit.category, null) : null,
  ].filter((c): c is fhir4.CodeableConcept => c !== null);
}

/** 観察項目の分類・コード。コードが無ければ ePath の「観察項目なし」を立てる。 */
function assessmentCategories(assessment: PathwayAssessment): fhir4.CodeableConcept[] {
  const bom = assessment.code_system === "bom";
  const categorySystem = bom
    ? PATHWAY_CODE_SYSTEM.bomAssessmentCategory
    : PATHWAY_CODE_SYSTEM.localAssessmentCategory;
  const codeSystem = bom ? PATHWAY_CODE_SYSTEM.bomAssessmentCode : PATHWAY_CODE_SYSTEM.localAssessmentCode;
  const categories = [
    codingOf(categorySystem, assessment.category_code, assessment.category_name),
    codingOf(codeSystem, assessment.code, assessment.name),
    // 看護観察(MEDIS)に結んだ観察項目は、評価入力でその表現タイプ(数値・列挙…)を借りる。
    codingOf(NURSING_OBSERVATION_CODE_SYSTEM, assessment.nursing_observation_manage_no, assessment.name),
  ].filter((c): c is fhir4.CodeableConcept => c !== null);
  if (categories.length > 0) return categories;

  return [{ coding: [{ system: PATHWAY_CODE_SYSTEM.assessmentCodeEmpty, code: EMPTY_ASSESSMENT_CODE }] }];
}

function taskCategory(task: PathwayTask): fhir4.CodeableConcept {
  const coding: fhir4.Coding[] = [
    { system: PATHWAY_CODE_SYSTEM.taskCategoryLv1, code: task.category_lv1 },
  ];
  if (task.category_lv2) {
    coding.push({ system: PATHWAY_CODE_SYSTEM.taskCategoryLv2, code: task.category_lv2 });
  }
  return { coding };
}

function reference(fullUrl: string): fhir4.Reference {
  return { reference: fullUrl };
}

// ---- 適用の transaction Bundle ----

export interface PathwayApplyBundle {
  bundle: fhir4.Bundle;
  /** 適用 1 件の識別子(識別子の先頭に入る uuid)。オーダーの印にも使う。 */
  applyKey: string;
  /** 病日 → その日の実日付。オーダー雛形の展開に使う。 */
  eventDates: Map<number, string>;
}

/**
 * パス定義を患者に適用する transaction Bundle。CarePlan の木と、未実施(preparation)の
 * Procedure タスクを作る。
 *
 * ［決定］タスクは適用の時点で「未実施」の Procedure として置く。パスシートは「その日に
 * 何をする予定か」を出すものなので、予定が FHIR 側に無いと定義マスタを読み直さないと
 * シートが描けない。実施したら status を completed にし、実施日時を入れる(第 2 段階の実施入力)。
 */
export function buildPathwayApplyBundle(input: PathwayApplyInput): PathwayApplyBundle {
  const { pathway, patientId, encounterId, admissionDate, institutionNumber } = input;
  const applyKey = input.applyKey || crypto.randomUUID();
  const applyId = applyIdValue(institutionNumber, applyKey);
  const applyUrl = `urn:uuid:${crypto.randomUUID()}`;
  const entry: fhir4.BundleEntry[] = [];
  const eventDates = new Map<number, string>();

  const events = [...pathway.events].sort(
    (a, b) => a.elapsed_days - b.elapsed_days || a.path_step - b.path_step,
  );
  // パス実施期間の開始は最初の病日(入院前日から始まるパスもある)。
  const periodStart = events.length > 0 ? pathwayEventDate(admissionDate, events[0].elapsed_days) : admissionDate;

  const apply: fhir4.CarePlan = {
    resourceType: "CarePlan",
    identifier: [{ system: PATHWAY_APPLY_ID_SYSTEM, value: applyId }],
    status: "active",
    intent: "plan",
    title: pathway.name,
    category: [markerCategory("apply")],
    subject: { reference: `Patient/${patientId}` },
    ...(encounterId ? { encounter: { reference: `Encounter/${encounterId}` } } : {}),
    period: { start: periodStart },
    instantiatesUri: [pathwayInstantiatesUri(pathway.pathway_code)],
    ...(input.conditionIds?.length
      ? { addresses: input.conditionIds.map((id) => ({ reference: `Condition/${id}` })) }
      : {}),
    extension: [
      {
        url: PATHWAY_EXT.adaptiveCriteriaConfirmation,
        valueCode: input.adaptiveCriteriaConfirmed ? "1" : "0",
      },
      { url: PATHWAY_EXT.adaptiveCriteriaText, valueString: pathway.adaptive_criteria ?? "" },
      ...(pathway.scheduled_days !== null
        ? [{ url: PATHWAY_EXT.scheduledDays, valueInteger: pathway.scheduled_days }]
        : []),
    ],
  };
  entry.push({ fullUrl: applyUrl, resource: apply, request: { method: "POST", url: "CarePlan" } });

  for (const event of events) {
    const date = pathwayEventDate(admissionDate, event.elapsed_days);
    eventDates.set(event.elapsed_days, date);
    const eventUrl = `urn:uuid:${crypto.randomUUID()}`;
    const eventId = eventIdValue(applyId, event.elapsed_days, event.path_step);
    entry.push({
      fullUrl: eventUrl,
      resource: buildEventCarePlan(event, { eventId, applyUrl, patientId, encounterId, date, pathway }),
      request: { method: "POST", url: "CarePlan" },
    });

    for (const [unitIndex, unit] of event.oat_units.entries()) {
      const unitUrl = `urn:uuid:${crypto.randomUUID()}`;
      const unitId = oatUnitIdValue(eventId, unit.unit_key);
      entry.push({
        fullUrl: unitUrl,
        resource: buildOatUnitCarePlan(unit, { unitId, applyUrl, eventUrl, patientId, order: unitIndex + 1 }),
        request: { method: "POST", url: "CarePlan" },
      });

      // 観察項目に結んでいないタスクは、ePath の規則どおり「観察項目なし」で包む。
      const looseTasks = unit.tasks.filter((task) => !task.assessment_key);
      const assessments: { key: string; assessment: PathwayAssessment | null; tasks: PathwayTask[] }[] = [
        ...unit.assessments.map((assessment) => ({
          key: assessment.assessment_key,
          assessment,
          tasks: unit.tasks.filter((task) => task.assessment_key === assessment.assessment_key),
        })),
        ...(looseTasks.length > 0
          ? [{ key: EMPTY_ASSESSMENT_CODE, assessment: null, tasks: looseTasks }]
          : []),
      ];

      for (const [assessmentIndex, row] of assessments.entries()) {
        const assessmentUrl = `urn:uuid:${crypto.randomUUID()}`;
        const assessmentId = assessmentIdValue(unitId, row.key);
        const goal = row.assessment ? buildAssessmentGoal(row.assessment, { assessmentId, patientId }) : null;
        const goalUrl = `urn:uuid:${crypto.randomUUID()}`;
        if (goal) entry.push({ fullUrl: goalUrl, resource: goal, request: { method: "POST", url: "Goal" } });
        entry.push({
          fullUrl: assessmentUrl,
          resource: buildAssessmentCarePlan(row.assessment, {
            assessmentId,
            applyUrl,
            eventUrl,
            unitUrl,
            patientId,
            order: assessmentIndex + 1,
            goalUrl: goal ? goalUrl : null,
          }),
          request: { method: "POST", url: "CarePlan" },
        });

        for (const [taskIndex, task] of row.tasks.entries()) {
          entry.push({
            fullUrl: `urn:uuid:${crypto.randomUUID()}`,
            resource: buildTaskProcedure(task, {
              taskId: taskIdValue(assessmentId, task.task_key),
              assessmentUrl,
              orderUrls: input.orderHeaderUrls?.get(pathwayTaskOrderKey(event, task.task_key)) ?? [],
              patientId,
              encounterId,
              date,
              order: taskIndex + 1,
            }),
            request: { method: "POST", url: "Procedure" },
          });
        }
      }
    }
  }

  return { bundle: { resourceType: "Bundle", type: "transaction", entry }, applyKey, eventDates };
}

function buildEventCarePlan(
  event: PathwayEvent,
  ctx: {
    eventId: string;
    applyUrl: string;
    patientId: string;
    encounterId?: string;
    date: string;
    pathway: PathwayDetail;
  },
): fhir4.CarePlan {
  const extension: fhir4.Extension[] = [
    { url: PATHWAY_EXT.eventElapsedDays, valueInteger: event.elapsed_days },
    { url: PATHWAY_EXT.pathStep, valueInteger: event.path_step },
    // 入外区分はパス定義が持つ(病日ごとに分けるのは第 3 段階)。
    { url: PATHWAY_EXT.inpatientOutpatientType, valueCode: ctx.pathway.setting === "outpatient" ? "O" : "I" },
  ];
  if (event.path_step_name) {
    extension.push({ url: PATHWAY_EXT.pathStepName, valueString: event.path_step_name });
  }
  return {
    resourceType: "CarePlan",
    identifier: [{ system: PATHWAY_EVENT_ID_SYSTEM, value: ctx.eventId }],
    status: "active",
    intent: "plan",
    title: event.title ?? "",
    category: [markerCategory("event")],
    subject: { reference: `Patient/${ctx.patientId}` },
    ...(ctx.encounterId ? { encounter: { reference: `Encounter/${ctx.encounterId}` } } : {}),
    // 病日は 1 日なので開始と終了を同じ日にする(date 検索の包含で「その日」が引ける)。
    period: { start: ctx.date, end: ctx.date },
    partOf: [reference(ctx.applyUrl)],
    extension,
  };
}

function buildOatUnitCarePlan(
  unit: PathwayOatUnit,
  ctx: { unitId: string; applyUrl: string; eventUrl: string; patientId: string; order: number },
): fhir4.CarePlan {
  return {
    resourceType: "CarePlan",
    identifier: [{ system: PATHWAY_OAT_UNIT_ID_SYSTEM, value: ctx.unitId }],
    status: "active",
    intent: "plan",
    title: unit.name,
    category: [markerCategory("oat-unit"), ...outcomeCategories(unit)],
    subject: { reference: `Patient/${ctx.patientId}` },
    partOf: [reference(ctx.applyUrl), reference(ctx.eventUrl)],
    extension: [
      { url: PATHWAY_EXT.statusTypeWhenOccured, valueCode: STATUS_TYPE_EP12 },
      { url: PATHWAY_EXT.criticalIndicator, valueCode: unit.critical ? YES : NO },
      // 適用の時点で作るアウトカムは予定どおりのもの。予定外は評価のときに足す。
      { url: PATHWAY_EXT.unplannedKind, valueCode: NO },
      { url: PATHWAY_DISPLAY_ORDER_EXT_URL, valueInteger: ctx.order },
    ],
  };
}

/**
 * 観察項目の適正値(評価基準)を持つ Goal。適正値の無い観察項目には作らない。
 *
 * ［決定］適正値は ePath の Goal AssessmentExecution の target.detailString に置く。CarePlan
 * (観察項目)には適正値の要素が無く、IG が適正値を持たせているのはこの Goal だけ。適正値は
 * 評価で生まれる記録ではなく計画の一部なので、アウトカムの Goal と違って適用の時点で作る。
 * 観察項目ごとの達成状態(achievementStatus)はここには書かない(実績値から導ける)。
 */
export function buildAssessmentGoal(
  assessment: Pick<PathwayAssessment, "name" | "code_system" | "code" | "proper_value">,
  ctx: { assessmentId: string; patientId: string },
): fhir4.Goal | null {
  const properValue = assessment.proper_value?.trim();
  if (!properValue) return null;
  const codeSystem =
    assessment.code_system === "bom" ? PATHWAY_CODE_SYSTEM.bomAssessmentCode : PATHWAY_CODE_SYSTEM.localAssessmentCode;
  return {
    resourceType: "Goal",
    identifier: [{ system: PATHWAY_ASSESSMENT_GOAL_ID_SYSTEM, value: ctx.assessmentId }],
    lifecycleStatus: "active",
    description: { text: assessment.name },
    subject: { reference: `Patient/${ctx.patientId}` },
    target: [
      {
        measure: {
          ...(assessment.code_system && assessment.code
            ? { coding: [{ system: codeSystem, code: assessment.code, display: assessment.name }] }
            : {}),
          text: assessment.name,
        },
        detailString: properValue,
      },
    ],
  };
}

/** 観察項目の Goal から適正値を読む。 */
export function assessmentGoalProperValue(goal: fhir4.Goal | undefined): string {
  if (!goal?.identifier?.some((id) => id.system === PATHWAY_ASSESSMENT_GOAL_ID_SYSTEM)) return "";
  return goal.target?.find((t) => t.detailString)?.detailString ?? "";
}

function buildAssessmentCarePlan(
  assessment: PathwayAssessment | null,
  ctx: {
    assessmentId: string;
    applyUrl: string;
    eventUrl: string;
    unitUrl: string;
    patientId: string;
    order: number;
    goalUrl: string | null;
  },
): fhir4.CarePlan {
  return {
    resourceType: "CarePlan",
    identifier: [{ system: PATHWAY_ASSESSMENT_ID_SYSTEM, value: ctx.assessmentId }],
    status: "active",
    intent: "plan",
    title: assessment?.name ?? "",
    category: [
      markerCategory("assessment"),
      ...(assessment
        ? assessmentCategories(assessment)
        : [{ coding: [{ system: PATHWAY_CODE_SYSTEM.assessmentCodeEmpty, code: EMPTY_ASSESSMENT_CODE }] }]),
    ],
    subject: { reference: `Patient/${ctx.patientId}` },
    partOf: [reference(ctx.applyUrl), reference(ctx.eventUrl), reference(ctx.unitUrl)],
    ...(ctx.goalUrl ? { goal: [reference(ctx.goalUrl)] } : {}),
    extension: [
      { url: PATHWAY_EXT.statusTypeWhenOccured, valueCode: STATUS_TYPE_EP12 },
      { url: PATHWAY_DISPLAY_ORDER_EXT_URL, valueInteger: ctx.order },
    ],
  };
}

function buildTaskProcedure(
  task: PathwayTask,
  ctx: {
    taskId: string;
    assessmentUrl: string;
    /** 雛形から出したオーダーのヘッダ(同じ transaction の fullUrl)。 */
    orderUrls: string[];
    patientId: string;
    encounterId?: string;
    date: string;
    order: number;
  },
): fhir4.Procedure {
  return {
    resourceType: "Procedure",
    identifier: [{ system: PATHWAY_TASK_ID_SYSTEM, value: ctx.taskId }],
    // ePath のタスクは preparation(未実施)/ completed(実施)の 2 値。
    status: "preparation",
    category: taskCategory(task),
    code: {
      ...(task.code ? { coding: [{ system: PATHWAY_CODE_SYSTEM.localTaskCode, code: task.code }] } : {}),
      text: task.name,
    },
    subject: { reference: `Patient/${ctx.patientId}` },
    ...(ctx.encounterId ? { encounter: { reference: `Encounter/${ctx.encounterId}` } } : {}),
    // 観察項目(計画)に加えて、雛形から出したオーダーも指す。参照の向きはタスク → オーダーの
    // 一方向で、オーダー側にはパスの印(stampPathwayOrders)だけを焼く。
    basedOn: [reference(ctx.assessmentUrl), ...ctx.orderUrls.map(reference)],
    extension: [
      { url: PATHWAY_EXT.taskPlannedDateTime, valueDate: ctx.date },
      { url: PATHWAY_DISPLAY_ORDER_EXT_URL, valueInteger: ctx.order },
    ],
  };
}

// ---- 読み出し ----

export function isPathwayCarePlan(carePlan: fhir4.CarePlan): boolean {
  return Boolean(
    carePlan.category?.some((category) =>
      category.coding?.some((c) => c.system === PATHWAY_MARKER_SYSTEM && c.code === PATHWAY_MARKER_CODE),
    ),
  );
}

export function pathwayLevelOf(carePlan: fhir4.CarePlan): PathwayLevel | null {
  for (const category of carePlan.category ?? []) {
    for (const coding of category.coding ?? []) {
      if (coding.system === PATHWAY_LEVEL_SYSTEM && coding.code) return coding.code as PathwayLevel;
    }
  }
  return null;
}

function identifierValue(resource: { identifier?: fhir4.Identifier[] }, system: string): string {
  return resource.identifier?.find((i) => i.system === system)?.value ?? "";
}

function extensionOf(resource: { extension?: fhir4.Extension[] }, url: string): fhir4.Extension | undefined {
  return resource.extension?.find((e) => e.url === url);
}

function intExtension(resource: { extension?: fhir4.Extension[] }, url: string): number | null {
  const value = extensionOf(resource, url)?.valueInteger;
  return typeof value === "number" ? value : null;
}

function codeExtension(resource: { extension?: fhir4.Extension[] }, url: string): string {
  return extensionOf(resource, url)?.valueCode ?? "";
}

/** 定義の並び(拡張)で整列する。拡張を持たないもの(古い適用)は元の順のまま末尾。 */
function sortByDisplayOrder<T extends { extension?: fhir4.Extension[] }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, order: intExtension(item, PATHWAY_DISPLAY_ORDER_EXT_URL) }))
    .sort((a, b) => {
      if (a.order === null && b.order === null) return a.index - b.index;
      if (a.order === null) return 1;
      if (b.order === null) return -1;
      return a.order - b.order || a.index - b.index;
    })
    .map((x) => x.item);
}

export interface PathwayTaskRecord {
  id: string;
  taskKey: string;
  /** 雛形から出したオーダー(ServiceRequest)の id。 */
  orderIds: string[];
  name: string;
  categoryLv1: string;
  categoryLv2: string;
  /** 未実施なら null。 */
  performedDateTime: string | null;
  plannedDate: string;
  done: boolean;
}

export interface PathwayAssessmentRecord {
  id: string;
  assessmentKey: string;
  name: string;
  /** 観察項目のコード(BOM / ローカル)。実績の Observation.code に写す。ローカルの階層コードは含まない。 */
  codings: fhir4.Coding[];
  /** 看護観察(MEDIS)の管理番号。結んでいなければ空。 */
  nursingObservationManageNo: string;
  /** 適正値(評価基準)。観察項目の Goal の target.detailString。無ければ空。 */
  properValue: string;
  tasks: PathwayTaskRecord[];
}

export interface PathwayOatUnitRecord {
  id: string;
  unitKey: string;
  /** ePath の OAT ユニット識別子(識別子の値そのもの)。Goal と評価の識別子の元。 */
  unitId: string;
  name: string;
  critical: boolean;
  unplanned: boolean;
  assessments: PathwayAssessmentRecord[];
}

export interface PathwayEventRecord {
  id: string;
  elapsedDays: number;
  pathStep: number;
  pathStepName: string;
  title: string;
  date: string;
  units: PathwayOatUnitRecord[];
}

export interface PathwayApplicationRecord {
  id: string;
  applyId: string;
  title: string;
  status: string;
  pathwayCode: string;
  periodStart: string;
  periodEnd: string;
  encounterId: string;
  scheduledDays: number | null;
  adaptiveCriteriaText: string;
  adaptiveCriteriaConfirmed: boolean;
  events: PathwayEventRecord[];
}

function pathwayCodeOf(carePlan: fhir4.CarePlan): string {
  const uri = carePlan.instantiatesUri?.find((u) => u.startsWith(pathwayInstantiatesUri("")));
  return uri ? uri.slice(pathwayInstantiatesUri("").length) : "";
}

/** partOf の参照先 id(Type/id の id だけ)。 */
function partOfIds(carePlan: fhir4.CarePlan): string[] {
  return (carePlan.partOf ?? []).flatMap((ref) => {
    const id = ref.reference?.split("/").pop();
    return id ? [id] : [];
  });
}

/**
 * 適用 1 件ぶんの CarePlan(適用・病日・OAT ユニット・観察項目)と Procedure(タスク)を、
 * 画面が読む木に組み直す。検索は `part-of=CarePlan/{適用の id}` の 1 回で足りる
 * (子孫は祖先すべてを partOf に持つ)ので、渡すのはその結果 + 適用そのもの。
 */
// ---- オーダー雛形の展開(続き) ----

/**
 * 雛形のオーダーを病日ごとに出すか、続く病日をまとめて 1 件にするか。
 * - each-day: 病日ごとに 1 件(注射・検査・処方など、その日に行うもの)
 * - run: 続く病日をまとめて 1 件にし、続きの最終日で終える(看護指示)
 * - meal / activity: 続く病日をまとめて 1 件にし、次の食事・安静度が始まる前で終える
 *   (同時に 2 つの食事・安静度が有効にならない)。次が無ければ終わりを決めない。
 */
export type PathwayOrderContinuity = "each-day" | "run" | "meal" | "activity";

export function orderContinuityOf(task: Pick<PathwayTask, "order_type" | "category_lv1">): PathwayOrderContinuity {
  if (task.order_type === "meal-order") return "meal";
  if (task.order_type === "nursing-order") return task.category_lv1 === "AL" ? "activity" : "run";
  return "each-day";
}

export interface PathwayOrderPlanEntry {
  task: PathwayTask;
  continuity: PathwayOrderContinuity;
  /** このオーダーが受け持つ病日(先頭がオーダーを出す日)。その日のタスクはどれもこのオーダーを指す。 */
  events: PathwayEvent[];
}

/** 雛形のオーダーとタスクの Procedure を結ぶキー(病日[-ステップ]/task_key)。 */
export function pathwayTaskOrderKey(event: Pick<PathwayEvent, "elapsed_days" | "path_step">, taskKey: string): string {
  return `${eventKeyOf(event.elapsed_days, event.path_step)}/${taskKey}`;
}

/**
 * 適用で出すオーダーの一覧(病日順)。［決定］同じ task_key のタスクが続く病日(並べた病日で
 * 隣り合うもの。ステップも 1 つの病日として数える)に置かれていれば、継続する種別は 1 件にまとめ、
 * 先頭の病日の雛形で出す。続きの途中で雛形を変えることはできない(定義画面が続き全体で揃える)。
 */
export function pathwayOrderPlan(pathway: Pick<PathwayDetail, "events">): PathwayOrderPlanEntry[] {
  const events = [...pathway.events].sort((a, b) => a.elapsed_days - b.elapsed_days || a.path_step - b.path_step);
  const plan: PathwayOrderPlanEntry[] = [];
  const open = new Map<string, { entry: PathwayOrderPlanEntry; lastIndex: number }>();
  events.forEach((event, index) => {
    for (const unit of event.oat_units) {
      for (const task of unit.tasks) {
        if (!task.order_type) continue;
        const continuity = orderContinuityOf(task);
        const current = continuity === "each-day" ? undefined : open.get(task.task_key);
        if (current && current.lastIndex === index - 1) {
          current.entry.events.push(event);
          current.lastIndex = index;
          continue;
        }
        const entry: PathwayOrderPlanEntry = { task, continuity, events: [event] };
        plan.push(entry);
        if (continuity !== "each-day") open.set(task.task_key, { entry, lastIndex: index });
      }
    }
  });
  return plan;
}

/** オーダーの開始(食事は食事の区切りまで)。除外したオーダーは null。 */
export interface PathwayOrderStart {
  date: string;
  mealTiming?: MealTiming;
}

export interface PathwayOrderEnd {
  date: string;
  mealTiming?: MealTiming;
}

/**
 * 続きをまとめたオーダーの終了。each-day は null。run は続きの最終日。meal / activity は、
 * 後に並ぶ同じ種類のオーダー(除外したものは数えない)の直前。食事は 1 つ前の食事の区切り、
 * 安静度は前日で、次が同じ日の途中のステップ(ステップ 2 以降)から始まるならその日まで。
 * 次が無い、または自分の開始より前になってしまうときは null(終わりを決めない)。
 */
export function pathwayOrderEnd(
  plan: PathwayOrderPlanEntry[],
  index: number,
  starts: (PathwayOrderStart | null)[],
  eventDate: (event: PathwayEvent) => string,
): PathwayOrderEnd | null {
  const entry = plan[index];
  const start = starts[index];
  if (!entry || !start || entry.continuity === "each-day") return null;
  if (entry.continuity === "run") return { date: eventDate(entry.events[entry.events.length - 1]) };

  const nextIndex = plan.findIndex((e, i) => i > index && e.continuity === entry.continuity && starts[i]);
  if (nextIndex < 0) return null;
  const next = starts[nextIndex] as PathwayOrderStart;
  if (entry.continuity === "meal") {
    const point = previousMealPoint(next.date, next.mealTiming ?? DEFAULT_MEAL_TIMING);
    return point.date < start.date ? null : { date: point.date, mealTiming: point.timing };
  }
  const nextEvent = plan[nextIndex].events[0];
  const date = nextEvent.path_step > 1 ? next.date : addDays(next.date, -1);
  return date < start.date ? null : { date };
}

/** フォーム値から開始を読む(終了の計算用)。 */
export function pathwayOrderStartOf(orderType: string, values: unknown): PathwayOrderStart | null {
  if (orderType === "meal-order") {
    const v = values as MealOrderFormValues;
    return v?.startDate ? { date: v.startDate, mealTiming: v.startTiming } : null;
  }
  if (orderType === "nursing-order") {
    const date = (values as NursingOrderFormValues)?.lines?.[0]?.startDate;
    return date ? { date } : null;
  }
  return null;
}

/**
 * 計算した終了をフォーム値に入れる。［決定］入力で終了日を決めてあればそちらを優先し、
 * 空のときだけ入れる(看護指示は行ごと)。
 */
export function withPathwayOrderEnd(orderType: string, values: unknown, end: PathwayOrderEnd | null): unknown {
  if (!end) return values;
  if (orderType === "nursing-order") {
    const v = values as NursingOrderFormValues;
    return { ...v, lines: v.lines.map((line) => (line.endDate ? line : { ...line, endDate: end.date })) };
  }
  if (orderType === "meal-order") {
    const v = values as MealOrderFormValues;
    return v.endDate ? v : { ...v, endDate: end.date, endTiming: end.mealTiming ?? v.endTiming };
  }
  return values;
}

// ---- 予定外 OAT ユニットの追加 ----

/** 予定外に足すアウトカム 1 件(その場で入力するので定義マスタは介さない)。 */
export interface UnplannedUnitInput {
  patientId: string;
  encounterId?: string;
  /** 適用(木の根)の CarePlan の id。 */
  applyCarePlanId: string;
  /** 足す先の病日の CarePlan の id と、その識別子・日付。 */
  eventCarePlanId: string;
  eventId: string;
  date: string;
  name: string;
  critical: boolean;
  /** 観察項目の名称(任意)。コードは持たせない。 */
  assessments: string[];
  /** タスク(任意)。オーダーを一緒に出すときは、そのヘッダの fullUrl を orderUrls に入れる。 */
  tasks: { name: string; categoryLv1: string; categoryLv2: string; orderUrls?: string[] }[];
  /** 同じ病日に既にあるアウトカムの数。並び順を末尾にするのに使う。 */
  existingUnitCount: number;
}

/**
 * 予定外のアウトカムを既にある適用へ足す transaction。
 *
 * ［決定］予定どおりのアウトカムと同じ形で作り、`EPathCarePlanUnplannedKind` だけを Y にする。
 * シートは同じ行として扱えて、評価も日次評価の仕組みがそのまま効く。
 *
 * タスクにオーダーを付けるときは、同じ transaction に積むオーダーのヘッダの fullUrl を
 * `orderUrls` で渡す。Procedure が basedOn でそれも指すので、定義から展開したタスクと
 * 同じようにシートからオーダーの状態を辿れる。
 */
export function buildUnplannedUnitBundle(input: UnplannedUnitInput): fhir4.Bundle {
  const unitKey = crypto.randomUUID();
  const unitId = oatUnitIdValue(input.eventId, unitKey);
  const unitUrl = `urn:uuid:${crypto.randomUUID()}`;
  const applyRef = `CarePlan/${input.applyCarePlanId}`;
  const eventRef = `CarePlan/${input.eventCarePlanId}`;

  const unit: fhir4.CarePlan = {
    resourceType: "CarePlan",
    identifier: [{ system: PATHWAY_OAT_UNIT_ID_SYSTEM, value: unitId }],
    status: "active",
    intent: "plan",
    title: input.name,
    category: [markerCategory("oat-unit")],
    subject: { reference: `Patient/${input.patientId}` },
    partOf: [reference(applyRef), reference(eventRef)],
    extension: [
      { url: PATHWAY_EXT.statusTypeWhenOccured, valueCode: STATUS_TYPE_EP12 },
      { url: PATHWAY_EXT.criticalIndicator, valueCode: input.critical ? YES : NO },
      { url: PATHWAY_EXT.unplannedKind, valueCode: YES },
      { url: PATHWAY_DISPLAY_ORDER_EXT_URL, valueInteger: input.existingUnitCount + 1 },
    ],
  };

  const entry: fhir4.BundleEntry[] = [
    { fullUrl: unitUrl, resource: unit, request: { method: "POST", url: "CarePlan" } },
  ];

  const assessmentEntry = (key: string, name: string | null, order: number) => {
    const assessmentId = assessmentIdValue(unitId, key);
    const url = `urn:uuid:${crypto.randomUUID()}`;
    const carePlan: fhir4.CarePlan = {
      resourceType: "CarePlan",
      identifier: [{ system: PATHWAY_ASSESSMENT_ID_SYSTEM, value: assessmentId }],
      status: "active",
      intent: "plan",
      title: name ?? "",
      category: [
        markerCategory("assessment"),
        { coding: [{ system: PATHWAY_CODE_SYSTEM.assessmentCodeEmpty, code: EMPTY_ASSESSMENT_CODE }] },
      ],
      subject: { reference: `Patient/${input.patientId}` },
      partOf: [reference(applyRef), reference(eventRef), reference(unitUrl)],
      extension: [
        { url: PATHWAY_EXT.statusTypeWhenOccured, valueCode: STATUS_TYPE_EP12 },
        { url: PATHWAY_DISPLAY_ORDER_EXT_URL, valueInteger: order },
      ],
    };
    entry.push({ fullUrl: url, resource: carePlan, request: { method: "POST", url: "CarePlan" } });
    return { assessmentId, url };
  };

  input.assessments.forEach((name, index) => assessmentEntry(crypto.randomUUID(), name, index + 1));

  if (input.tasks.length > 0) {
    // タスクは定義と同じく「観察項目なし」で包む(結び先を選ばせる画面は持たない)。
    const wrapper = assessmentEntry(EMPTY_ASSESSMENT_CODE, null, input.assessments.length + 1);
    input.tasks.forEach((task, index) => {
      const procedure: fhir4.Procedure = {
        resourceType: "Procedure",
        identifier: [{ system: PATHWAY_TASK_ID_SYSTEM, value: taskIdValue(wrapper.assessmentId, crypto.randomUUID()) }],
        status: "preparation",
        category: taskCategory({
          category_lv1: task.categoryLv1,
          category_lv2: task.categoryLv2 || null,
        } as PathwayTask),
        code: { text: task.name },
        subject: { reference: `Patient/${input.patientId}` },
        ...(input.encounterId ? { encounter: { reference: `Encounter/${input.encounterId}` } } : {}),
        basedOn: [reference(wrapper.url), ...(task.orderUrls ?? []).map(reference)],
        extension: [
          { url: PATHWAY_EXT.taskPlannedDateTime, valueDate: input.date },
          { url: PATHWAY_DISPLAY_ORDER_EXT_URL, valueInteger: index + 1 },
        ],
      };
      entry.push({ resource: procedure, request: { method: "POST", url: "Procedure" } });
    });
  }

  return { resourceType: "Bundle", type: "transaction", entry };
}

export function parsePathwayApplication(
  resources: (fhir4.CarePlan | fhir4.Procedure)[],
  goals: Map<string, fhir4.Goal> = new Map(),
): PathwayApplicationRecord | null {
  const carePlans = resources.filter((r): r is fhir4.CarePlan => r.resourceType === "CarePlan");
  const procedures = resources.filter((r): r is fhir4.Procedure => r.resourceType === "Procedure");
  const apply = carePlans.find((cp) => pathwayLevelOf(cp) === "apply");
  if (!apply?.id) return null;

  const tasksByAssessment = new Map<string, PathwayTaskRecord[]>();
  for (const procedure of sortByDisplayOrder(procedures)) {
    const basedOn = procedure.basedOn ?? [];
    const assessmentId = basedOn
      .map((ref) => ref.reference?.match(/^CarePlan\/(.+)$/)?.[1])
      .find((id): id is string => Boolean(id));
    if (!assessmentId) continue;
    const taskId = identifierValue(procedure, PATHWAY_TASK_ID_SYSTEM);
    const rows = tasksByAssessment.get(assessmentId) ?? [];
    rows.push({
      id: procedure.id ?? "",
      taskKey: taskId.split(".").pop() ?? "",
      orderIds: basedOn
        .map((ref) => ref.reference?.match(/^ServiceRequest\/(.+)$/)?.[1])
        .filter((id): id is string => Boolean(id)),
      name: procedure.code?.text ?? "",
      categoryLv1:
        procedure.category?.coding?.find((c) => c.system === PATHWAY_CODE_SYSTEM.taskCategoryLv1)?.code ?? "",
      categoryLv2:
        procedure.category?.coding?.find((c) => c.system === PATHWAY_CODE_SYSTEM.taskCategoryLv2)?.code ?? "",
      performedDateTime: procedure.performedDateTime ?? null,
      plannedDate: extensionOf(procedure, PATHWAY_EXT.taskPlannedDateTime)?.valueDate ?? "",
      done: procedure.status === "completed",
    });
    tasksByAssessment.set(assessmentId, rows);
  }

  const assessmentsByUnit = new Map<string, PathwayAssessmentRecord[]>();
  for (const carePlan of sortByDisplayOrder(carePlans)) {
    if (pathwayLevelOf(carePlan) !== "assessment" || !carePlan.id) continue;
    // partOf は [適用, 病日, OAT ユニット]。直近の祖先が OAT ユニット。
    const unitId = partOfIds(carePlan).at(-1);
    if (!unitId) continue;
    const assessmentId = identifierValue(carePlan, PATHWAY_ASSESSMENT_ID_SYSTEM);
    const codings = (carePlan.category ?? [])
      .flatMap((c) => c.coding ?? [])
      .filter((c) => c.system !== PATHWAY_MARKER_SYSTEM && c.system !== PATHWAY_LEVEL_SYSTEM);
    const rows = assessmentsByUnit.get(unitId) ?? [];
    rows.push({
      id: carePlan.id,
      assessmentKey: assessmentId.split(".").pop() ?? "",
      name: carePlan.title ?? "",
      codings: codings.filter((c) => c.system !== NURSING_OBSERVATION_CODE_SYSTEM),
      nursingObservationManageNo: codings.find((c) => c.system === NURSING_OBSERVATION_CODE_SYSTEM)?.code ?? "",
      properValue:
        (carePlan.goal ?? [])
          .map((ref) => assessmentGoalProperValue(goals.get(ref.reference?.split("/").pop() ?? "")))
          .find(Boolean) ?? "",
      tasks: tasksByAssessment.get(carePlan.id) ?? [],
    });
    assessmentsByUnit.set(unitId, rows);
  }

  const unitsByEvent = new Map<string, PathwayOatUnitRecord[]>();
  for (const carePlan of sortByDisplayOrder(carePlans)) {
    if (pathwayLevelOf(carePlan) !== "oat-unit" || !carePlan.id) continue;
    const eventId = partOfIds(carePlan).at(-1);
    if (!eventId) continue;
    const unitId = identifierValue(carePlan, PATHWAY_OAT_UNIT_ID_SYSTEM);
    const rows = unitsByEvent.get(eventId) ?? [];
    rows.push({
      id: carePlan.id,
      unitKey: unitId.split(".").pop() ?? "",
      unitId,
      name: carePlan.title ?? "",
      critical: codeExtension(carePlan, PATHWAY_EXT.criticalIndicator) === YES,
      unplanned: codeExtension(carePlan, PATHWAY_EXT.unplannedKind) === YES,
      assessments: assessmentsByUnit.get(carePlan.id) ?? [],
    });
    unitsByEvent.set(eventId, rows);
  }

  const events: PathwayEventRecord[] = carePlans
    .filter((cp) => pathwayLevelOf(cp) === "event" && cp.id)
    .map((carePlan) => ({
      id: carePlan.id as string,
      elapsedDays: intExtension(carePlan, PATHWAY_EXT.eventElapsedDays) ?? 0,
      pathStep: intExtension(carePlan, PATHWAY_EXT.pathStep) ?? 1,
      pathStepName: extensionOf(carePlan, PATHWAY_EXT.pathStepName)?.valueString ?? "",
      title: carePlan.title ?? "",
      date: carePlan.period?.start ?? "",
      units: unitsByEvent.get(carePlan.id as string) ?? [],
    }))
    .sort((a, b) => a.elapsedDays - b.elapsedDays || a.pathStep - b.pathStep);

  return {
    id: apply.id,
    applyId: identifierValue(apply, PATHWAY_APPLY_ID_SYSTEM),
    title: apply.title ?? "",
    status: apply.status,
    pathwayCode: pathwayCodeOf(apply),
    periodStart: apply.period?.start ?? "",
    periodEnd: apply.period?.end ?? "",
    encounterId: apply.encounter?.reference?.split("/").pop() ?? "",
    scheduledDays: intExtension(apply, PATHWAY_EXT.scheduledDays),
    adaptiveCriteriaText: extensionOf(apply, PATHWAY_EXT.adaptiveCriteriaText)?.valueString ?? "",
    adaptiveCriteriaConfirmed: codeExtension(apply, PATHWAY_EXT.adaptiveCriteriaConfirmation) === "1",
    events,
  };
}
