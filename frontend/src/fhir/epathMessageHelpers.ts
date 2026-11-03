import type { PathwayDetail, PathwayEvent, PathwayTask } from "../api/masterClient";
import { conditionManagementNumber, ICD10_SYSTEM } from "./conditionHelpers";
import { departmentCode } from "./departmentHelpers";
import { encounterDischargeDisposition } from "./encounterHelpers";
import { parseJapaneseNames } from "./humanName";
import {
  EMPTY_ASSESSMENT_CODE,
  PATHWAY_CODE_SYSTEM,
  PATHWAY_LEVEL_SYSTEM,
  PATHWAY_MARKER_SYSTEM,
  type PathwayApplicationRecord,
  type PathwayAssessmentRecord,
  type PathwayEventRecord,
  type PathwayOatUnitRecord,
  type PathwayTaskRecord,
} from "./pathwayApplyHelpers";
import { pathwayCloseValuesOf } from "./pathwayCloseHelpers";
import type { PathwayEvaluationState, UnitEvaluation } from "./pathwayEvaluationHelpers";
import { eventDayStepLabel, pathStepLabel } from "./pathwayHelpers";
import type { PathwayMajorEvent } from "./pathwayMajorEventHelpers";
import { patientNumberOf } from "./patientHelpers";
import { practitionerRoleLabel } from "./practitionerRoleHelpers";
import { localDay } from "../lib/dates";

// ePath メッセージ(JAMI 標準 JAMISDP04「ePath のデータ要素と構造に関する仕様書」の XML)。
// JAHIS ePath 実装ガイド Ver.1.0 第 6 章の要素順・記述例に合わせて、適用後パスデータ(パス状態区分 12)と
// 施設パス(02)を文字列で組む。React にも FHIR の読み込みにも依存しない(材料は呼び出し側が集める)。
// 設計は docs/clinical-pathway-design.md §7.14。

/** コード体系 OID(実装ガイド 付録 1)。 */
export const EPATH_OID = {
  standardPathCode: "1.2.392.200250.2.2.50.10",
  department: "1.2.392.200250.2.2.2",
  medisDisease: "1.2.392.200119.4.101.2",
  icd10: "2.16.840.1.113883.6.3",
  bomOutcomeCategory: "1.2.392.200250.3.2.200.10",
  bomOutcomeSubcategory: "1.2.392.200250.3.2.200.20",
  bomOutcomeCode: "1.2.392.200250.3.2.200.30",
  bomAssessmentCategory: "1.2.392.200250.3.2.200.40",
  bomAssessmentCode: "1.2.392.200250.3.2.200.50",
} as const;

/** 施設等のローカルコード体系の印(実装ガイドの例に倣う)。 */
export const LOCAL_CODE_SYSTEM = "LOCAL";

/** パス状態区分。01 ひな型パス / 02 施設パス / 12 適用後パス。 */
export type EpathStatusType = "01" | "02" | "12";

// ---- 文字列の組み立て ----

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Attrs = Record<string, string | undefined>;

function attrs(values: Attrs): string {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
}

/** 子を持つ要素。子が無ければ空要素。 */
function el(name: string, children: string[] | string, attributes: Attrs = {}): string {
  const body = Array.isArray(children) ? children.filter(Boolean).join("") : children;
  return body ? `<${name}${attrs(attributes)}>${body}</${name}>` : `<${name}${attrs(attributes)}/>`;
}

function text(name: string, value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

function coded(name: string, code: string, displayName: string, codeSystem: string): string {
  return el(name, "", { code, displayName, codeSystem });
}

/** FHIR の日付・日時を ePath の YYYYMMDD[HHMMSS] にする(オフセットは落とし、書かれた時刻のまま)。 */
export function epathDateTime(value: string | undefined | null): string {
  if (!value) return "";
  const [datePart, timePart] = value.split("T");
  const date = datePart.replace(/-/g, "");
  if (!timePart) return date;
  const time = timePart.replace(/[+-]\d{2}:\d{2}$|Z$/, "").split(".")[0].replace(/:/g, "");
  return `${date}${time}`;
}

export function epathDate(value: string | undefined | null): string {
  return value ? localDay(value).replace(/-/g, "") : "";
}

/** 患者 ID は 10 桁固定(左 0 埋め)。 */
export function epathPatientId(number: string): string {
  return number.padStart(10, "0");
}

/**
 * 施設で使う標準クリニカルパスコード。ひな型の医療機関コード(0000000000)を自院の 10 桁に差し替える。
 * 標準コードを持たない施設独自のパスは空(ローカルコードだけ)。
 */
export function facilityStandardPathCode(standardPathCode: string | null, institution: string): string {
  if (!standardPathCode) return "";
  const rest = standardPathCode.slice(standardPathCode.indexOf("-") + 1);
  return `${(institution || "0000000000").padStart(10, "0")}-${rest}`;
}

// ---- 共通の部品 ----

export interface EpathFacility {
  /** 保険医療機関コード 10 桁。 */
  id: string;
  name: string;
}

export interface EpathAuthor {
  datetime: string;
  name: string;
  job: string;
}

/** 記録者が無いときの固定値(実装ガイド 6.5.2.1.2.2(4)・6.5.2.2(3))。 */
const NO_AUTHOR = { name: "記載なし", job: "指定なし" };

function author(value: EpathAuthor): string {
  return el("author", "", {
    datetime: value.datetime,
    name: value.name || NO_AUTHOR.name,
    job: value.job || NO_AUTHOR.job,
  });
}

function identification(
  detail: Pick<
    PathwayDetail,
    "pathway_code" | "name" | "standard_path_code" | "standard_path_name" | "template_version" | "version"
  >,
  status: EpathStatusType,
  institution: string,
): string {
  const standard = facilityStandardPathCode(detail.standard_path_code, institution);
  return el("ePathIdentification", [
    standard ? coded("code", standard, detail.standard_path_name ?? "", EPATH_OID.standardPathCode) : "",
    coded("code", detail.pathway_code, detail.name, LOCAL_CODE_SYSTEM),
    text("ePathStatusType", status),
    text("templateVersion", detail.template_version || "0"),
    status === "01" ? "" : text("facilityTemplateVersion", detail.version || "1"),
  ]);
}

function facility(value: EpathFacility): string {
  return el("facility", [text("id", value.id), text("name", value.name)]);
}

/** 病日の名前。見出しに加え、分けた病日はステップ名(「2日目術前」のように)を添える。 */
function eventName(elapsedDays: number, title: string, pathStep: number, pathStepName: string, split: boolean): string {
  const base = eventDayStepLabel(elapsedDays, title, 1, "");
  return split ? `${base}${pathStepLabel(pathStep, pathStepName)}` : base;
}

/** 分けた病日(同じ病日に複数のステップ)の病日番号の集合。 */
function splitDays(days: { elapsedDays: number }[]): Set<number> {
  const counts = new Map<number, number>();
  for (const day of days) counts.set(day.elapsedDays, (counts.get(day.elapsedDays) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([day]) => day));
}

// ---- 施設パス(02): 定義マスタから ----

export interface FacilityPathwayXmlInput {
  pathway: PathwayDetail;
  facility: EpathFacility;
  /** 診療科の SS-MIX2 コード → 名称。無ければローカルコードで出す。 */
  departmentName?: string;
}

/** アウトカムの分類・コード・重要の要素(outcome の先頭に並ぶ部分)。 */
function outcomeHeadOfDefinition(unit: PathwayDetail["events"][number]["oat_units"][number]): string[] {
  const bom = unit.code_system === "bom";
  return [
    unit.category
      ? coded("category", unit.category, outcomeCategoryName(unit.category), EPATH_OID.bomOutcomeCategory)
      : "",
    bom && unit.subcategory_code
      ? coded("subcategory", unit.subcategory_code, unit.subcategory_name ?? "", EPATH_OID.bomOutcomeSubcategory)
      : "",
    coded("code", unit.code || unit.unit_key, unit.name, bom && unit.code ? EPATH_OID.bomOutcomeCode : LOCAL_CODE_SYSTEM),
    text("criticalIndicator", unit.critical ? "Y" : "N"),
  ];
}

function outcomeCategoryName(code: string): string {
  return { G: "患者目標", H: "患者状態", K: "知識・教育・理解", F: "生活動作・日常動作・リハビリ" }[code] ?? "";
}

function taskOfDefinition(task: PathwayTask): string {
  return el("task", [
    text("category", task.category_lv2 || task.category_lv1),
    coded("code", task.code || task.task_key, task.name, LOCAL_CODE_SYSTEM),
  ]);
}

function assessmentOfDefinition(
  assessment: PathwayDetail["events"][number]["oat_units"][number]["assessments"][number] | null,
  task: PathwayTask | null,
  status: EpathStatusType,
): string {
  const bom = assessment?.code_system === "bom";
  return el("assessment", [
    el("assessmentIdentification", [text("ePathStatusType", status)]),
    assessment?.category_code && bom
      ? coded("category", assessment.category_code, assessment.category_name ?? "", EPATH_OID.bomAssessmentCategory)
      : "",
    assessment
      ? coded(
          "code",
          assessment.code || assessment.assessment_key,
          assessment.name,
          bom && assessment.code ? EPATH_OID.bomAssessmentCode : LOCAL_CODE_SYSTEM,
        )
      : coded("code", EMPTY_ASSESSMENT_CODE, "観察項目なし", LOCAL_CODE_SYSTEM),
    assessment?.proper_value ? text("properValue", assessment.proper_value) : "",
    task ? taskOfDefinition(task) : "",
  ]);
}

/**
 * 観察項目の要素列。ePath の observation は task を 0..1 しか持てないので、タスクが複数の観察項目は
 * 同じ観察項目をタスクごとに繰り返す。観察項目に結ばないタスクは「観察項目なし」(ZZZZZZZZZZ)で包む。
 */
function assessmentElementsOfDefinition(
  unit: PathwayDetail["events"][number]["oat_units"][number],
  status: EpathStatusType,
): string[] {
  const elements: string[] = [];
  for (const assessment of unit.assessments) {
    const tasks = unit.tasks.filter((t) => t.assessment_key === assessment.assessment_key);
    if (tasks.length === 0) elements.push(assessmentOfDefinition(assessment, null, status));
    for (const task of tasks) elements.push(assessmentOfDefinition(assessment, task, status));
  }
  for (const task of unit.tasks.filter((t) => !t.assessment_key)) {
    elements.push(assessmentOfDefinition(null, task, status));
  }
  return elements;
}

export function buildFacilityPathwayXml(input: FacilityPathwayXmlInput): string {
  const { pathway } = input;
  const events = [...pathway.events].sort((a, b) => a.elapsed_days - b.elapsed_days || a.path_step - b.path_step);
  const split = splitDays(events.map((e) => ({ elapsedDays: e.elapsed_days })));
  const majors = events
    .filter((e) => e.major_event_name)
    .map((e) =>
      el("majorEvent", [text("eventName", e.major_event_name), text("eventElapsedDays", e.elapsed_days)]),
    );
  const body = el("ePathMessage", [
    identification(pathway, "02", input.facility.id),
    facility(input.facility),
    el("admission", [
      pathway.department_code
        ? coded("clinicalDepartment", pathway.department_code, input.departmentName || pathway.department_name || "", EPATH_OID.department)
        : "",
      ...pathway.indications.flatMap((d) => [
        coded("disease", d.management_number, d.name, EPATH_OID.medisDisease),
        d.icd10 ? coded("disease", d.icd10, d.name, EPATH_OID.icd10) : "",
      ]),
      ...majors,
    ]),
    el("ePathApply", [
      el("basicInformation", [
        el("adaptiveCriteria", [text("text", pathway.adaptive_criteria ?? "")]),
        pathway.scheduled_days !== null ? text("scheduledDays", pathway.scheduled_days) : "",
      ]),
      ...events.map((event: PathwayEvent) =>
        el("event", [
          text("eventElapsedDays", event.elapsed_days),
          text(
            "eventName",
            eventName(event.elapsed_days, event.title ?? "", event.path_step, event.path_step_name ?? "", split.has(event.elapsed_days)),
          ),
          ...event.oat_units.map((unit) =>
            el("oatUnit", [
              el("oatUnitIdentification", [text("id", unit.unit_key), text("ePathStatusType", "02")]),
              el("outcome", [...outcomeHeadOfDefinition(unit), ...assessmentElementsOfDefinition(unit, "02")]),
            ]),
          ),
        ]),
      ),
    ]),
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

// ---- 適用後パスデータ(12): 適用の木と記録から ----

export interface AppliedPathwayXmlInput {
  pathway: PathwayDetail;
  application: PathwayApplicationRecord;
  /** 木の CarePlan(id → CarePlan)。OAT ユニット・観察項目のコードを読む。 */
  carePlans: Map<string, fhir4.CarePlan>;
  /** タスクの Procedure(id → Procedure)。実施者を読む。 */
  procedures: Map<string, fhir4.Procedure>;
  /** タスクが指すオーダー(id → ServiceRequest)。タスクコードの元。 */
  orders: Map<string, fhir4.ServiceRequest>;
  evaluation: PathwayEvaluationState;
  /** 適用の Goal(終了・中止)。無ければ進行中。 */
  applyGoal: fhir4.Goal | null;
  applyCarePlan: fhir4.CarePlan;
  majorEvents: Map<string, PathwayMajorEvent>;
  facility: EpathFacility;
  patient: fhir4.Patient;
  encounter: fhir4.Encounter | null;
  /** 入院の診療科(Encounter.serviceProvider)。 */
  department: fhir4.Organization | null;
  /** 適用が指す病名(CarePlan.addresses)。 */
  conditions: fhir4.Condition[];
  /** 記録者(Practitioner の id)→ 職種コード。無い人は「指定なし」。 */
  jobOf: (practitionerId: string) => string;
  /**
   * タスクの実施。パスシートと同じ判定(チェックリストはタスクの Procedure、オーダーを結んだタスクは
   * オーダーの実施記録・進捗)で、その病日の実施の有無と、分かれば日時・実施者。
   */
  taskPerformOf: (task: PathwayTaskRecord, date: string) => TaskPerform;
}

export interface TaskPerform {
  done: boolean;
  /** 実施日時(FHIR の dateTime)。分からなければ空。 */
  at: string;
  performer: fhir4.Reference | undefined;
}

function codingsOf(carePlan: fhir4.CarePlan | undefined): fhir4.Coding[] {
  return (carePlan?.category ?? [])
    .flatMap((c) => c.coding ?? [])
    .filter((c) => c.system !== PATHWAY_MARKER_SYSTEM && c.system !== PATHWAY_LEVEL_SYSTEM);
}

function codingOf(codings: fhir4.Coding[], system: string): fhir4.Coding | undefined {
  return codings.find((c) => c.system === system);
}

function practitionerIdOf(reference: fhir4.Reference | undefined): string {
  return reference?.reference?.split("/").pop() ?? "";
}

function authorOf(
  performer: fhir4.Reference | undefined,
  datetime: string,
  jobOf: AppliedPathwayXmlInput["jobOf"],
): EpathAuthor {
  return {
    datetime: epathDateTime(datetime),
    name: performer?.display ?? "",
    job: practitionerRoleLabel(jobOf(practitionerIdOf(performer))),
  };
}

/** 実績の Observation の値と単位。2 数値(血圧など)は「a:b」。 */
function observationResult(observation: fhir4.Observation): { value: string; unit: string } {
  if (observation.valueQuantity?.value !== undefined) {
    return { value: String(observation.valueQuantity.value), unit: observation.valueQuantity.unit ?? "" };
  }
  if (observation.valueString !== undefined) return { value: observation.valueString, unit: "" };
  const concept = observation.valueCodeableConcept;
  if (concept) return { value: concept.text ?? concept.coding?.[0]?.display ?? "", unit: "" };
  const components = (observation.component ?? []).filter((c) => c.valueQuantity?.value !== undefined);
  if (components.length >= 2) {
    return {
      value: components.map((c) => c.valueQuantity?.value).join(":"),
      unit: components.map((c) => c.valueQuantity?.unit ?? "").join(":"),
    };
  }
  return { value: "", unit: "" };
}

function achievementOf(evaluation: UnitEvaluation | undefined): "1" | "2" | "3" | "" {
  return (evaluation?.achievement ?? "") as "1" | "2" | "3" | "";
}

function assessmentExecution(
  assessment: PathwayAssessmentRecord,
  unitEvaluation: UnitEvaluation | undefined,
  input: AppliedPathwayXmlInput,
): string {
  const result = input.evaluation.results.get(assessment.id);
  if (!result) return "";
  // 観察項目ごとの達成は記録していない(G-6)。アウトカムが達成なら達成、それ以外は未評価として出す。
  const status = achievementOf(unitEvaluation) === "1" ? "1" : "3";
  const { value, unit } = observationResult(result);
  return el("execution", [
    text("status", status),
    author(authorOf(result.performer?.[0], result.effectiveDateTime ?? "", input.jobOf)),
    value ? el("observationResult", "", { value, unit, datetime: epathDateTime(result.effectiveDateTime) }) : "",
  ]);
}

function taskOfApplication(task: PathwayTaskRecord, date: string, input: AppliedPathwayXmlInput): string {
  const procedure = input.procedures.get(task.id);
  const order = task.orderIds.map((id) => input.orders.get(id)).find(Boolean);
  const localCode = procedure?.code?.coding?.find((c) => c.system === PATHWAY_CODE_SYSTEM.localTaskCode)?.code;
  const orderCode = order?.code?.coding?.[0];
  const perform = input.taskPerformOf(task, date);
  return el("task", [
    text("category", task.categoryLv2 || task.categoryLv1),
    coded("code", localCode || orderCode?.code || task.taskKey, task.name, orderCode?.system && !localCode ? orderCode.system : LOCAL_CODE_SYSTEM),
    task.plannedDate ? text("planDate", epathDate(task.plannedDate)) : "",
    perform.done && perform.at ? text("performedDate", epathDateTime(perform.at)) : "",
    el("execution", [
      text("status", perform.done ? "1" : "2"),
      perform.done ? author(authorOf(perform.performer, perform.at || date, input.jobOf)) : "",
    ]),
  ]);
}

function assessmentOfApplication(
  assessment: PathwayAssessmentRecord | null,
  task: PathwayTaskRecord | null,
  unitEvaluation: UnitEvaluation | undefined,
  unit: PathwayOatUnitRecord,
  date: string,
  input: AppliedPathwayXmlInput,
): string {
  const carePlan = assessment ? input.carePlans.get(assessment.id) : undefined;
  const codings = codingsOf(carePlan);
  const bomCode = codingOf(codings, PATHWAY_CODE_SYSTEM.bomAssessmentCode);
  const localCode = codingOf(codings, PATHWAY_CODE_SYSTEM.localAssessmentCode);
  const bomCategory = codingOf(codings, PATHWAY_CODE_SYSTEM.bomAssessmentCategory);
  const status: EpathStatusType = unit.unplanned ? "12" : "02";
  return el("assessment", [
    el("assessmentIdentification", [text("ePathStatusType", status)]),
    bomCategory ? coded("category", bomCategory.code ?? "", bomCategory.display ?? "", EPATH_OID.bomAssessmentCategory) : "",
    assessment
      ? bomCode
        ? coded("code", bomCode.code ?? "", assessment.name, EPATH_OID.bomAssessmentCode)
        : coded("code", localCode?.code || assessment.assessmentKey, assessment.name, LOCAL_CODE_SYSTEM)
      : coded("code", EMPTY_ASSESSMENT_CODE, "観察項目なし", LOCAL_CODE_SYSTEM),
    assessment?.properValue ? text("properValue", assessment.properValue) : "",
    assessment ? assessmentExecution(assessment, unitEvaluation, input) : "",
    task ? taskOfApplication(task, date, input) : "",
  ]);
}

function judgementOf(evaluation: UnitEvaluation | undefined, input: AppliedPathwayXmlInput): string {
  const status = achievementOf(evaluation);
  if (!evaluation || !status) return "";
  const observation = evaluation.observation;
  const variance =
    status === "2"
      ? el("variance", [
          text("subjective", evaluation.soap.S),
          text("objective", evaluation.soap.O),
          text("assessment", evaluation.soap.A),
          text("plan", evaluation.mode === "free" ? evaluation.freeText : evaluation.soap.P),
        ])
      : "";
  return el("judgement", [
    text("status", status),
    variance,
    author(authorOf(observation?.performer?.[0], evaluation.recordedAt || observation?.effectiveDateTime || "", input.jobOf)),
  ]);
}

function oatUnitOfApplication(unit: PathwayOatUnitRecord, date: string, input: AppliedPathwayXmlInput): string {
  const codings = codingsOf(input.carePlans.get(unit.id));
  const category = codingOf(codings, PATHWAY_CODE_SYSTEM.bomOutcomeCategory);
  const subcategory = codingOf(codings, PATHWAY_CODE_SYSTEM.bomOutcomeSubcategory);
  const bomCode = codingOf(codings, PATHWAY_CODE_SYSTEM.bomOutcomeCode);
  const localCode = codingOf(codings, PATHWAY_CODE_SYSTEM.localOutcomeCode);
  const unitEvaluation = input.evaluation.units.get(unit.id);
  const assessments: string[] = [];
  for (const assessment of unit.assessments) {
    // 「観察項目なし」で包んだだけの観察項目は名前が無い。中のタスクをそれぞれ ZZZZZZZZZZ で出す。
    const wrapper = !assessment.name;
    if (assessment.tasks.length === 0 && !wrapper) {
      assessments.push(assessmentOfApplication(assessment, null, unitEvaluation, unit, date, input));
    }
    for (const task of assessment.tasks) {
      assessments.push(assessmentOfApplication(wrapper ? null : assessment, task, unitEvaluation, unit, date, input));
    }
  }
  return el("oatUnit", [
    el("oatUnitIdentification", [text("id", unit.unitId), text("ePathStatusType", unit.unplanned ? "12" : "02")]),
    el("outcome", [
      category ? coded("category", category.code ?? "", outcomeCategoryName(category.code ?? ""), EPATH_OID.bomOutcomeCategory) : "",
      subcategory ? coded("subcategory", subcategory.code ?? "", subcategory.display ?? "", EPATH_OID.bomOutcomeSubcategory) : "",
      bomCode
        ? coded("code", bomCode.code ?? "", unit.name, EPATH_OID.bomOutcomeCode)
        : coded("code", localCode?.code || unit.unitKey, unit.name, LOCAL_CODE_SYSTEM),
      text("criticalIndicator", unit.critical ? "Y" : "N"),
      ...assessments,
      judgementOf(unitEvaluation, input),
    ]),
  ]);
}

function compAssessmentOf(event: PathwayEventRecord, input: AppliedPathwayXmlInput): string {
  const day = input.evaluation.days.get(event.id);
  if (!day) {
    return el("compAssessment", [
      text("text", "評価なし"),
      author({ datetime: epathDate(event.date), name: "", job: "" }),
    ]);
  }
  return el("compAssessment", [
    text("text", day.text),
    author(authorOf(day.observation.performer?.[0], day.recordedAt, input.jobOf)),
  ]);
}

function patientOf(patient: fhir4.Patient): string {
  const names = parseJapaneseNames(patient.name);
  const gender = patient.gender === "male" ? "M" : patient.gender === "female" ? "F" : "UN";
  return el("patient", [
    text("id", epathPatientId(patientNumberOf(patient) ?? patient.id ?? "")),
    el("name", [text("family", names.familyKanji), text("given", names.givenKanji)], { use: "IDE" }),
    names.familyKana || names.givenKana
      ? el("name", [text("family", names.familyKana), text("given", names.givenKana)], { use: "SYL" })
      : "",
    text("administrativeGender", gender),
    text("birthdate", epathDate(patient.birthDate)),
  ]);
}

function admissionOf(input: AppliedPathwayXmlInput, events: PathwayEventRecord[]): string {
  const { encounter, department } = input;
  const ssmix = department ? departmentCode(department) : input.pathway.department_code ?? "";
  const deptName = department?.name ?? encounter?.serviceProvider?.display ?? input.pathway.department_name ?? "";
  // 入院予定(planned)の Encounter の日付は予定にすぎないので、病日 1 の日付を入院日とする。
  const admitted = encounter && encounter.status !== "planned" && encounter.status !== "cancelled";
  const diseases = input.conditions.flatMap((condition) => {
    const name = condition.code?.text ?? condition.code?.coding?.[0]?.display ?? "";
    const medis = conditionManagementNumber(condition);
    const icd = condition.code?.coding?.find((c) => c.system === ICD10_SYSTEM)?.code;
    return [
      medis ? coded("disease", medis, name, EPATH_OID.medisDisease) : "",
      icd ? coded("disease", icd, name, EPATH_OID.icd10) : "",
    ];
  });
  const majors = events
    .map((event) => input.majorEvents.get(event.id))
    .filter((m): m is PathwayMajorEvent => Boolean(m))
    .map((major) => {
      const event = events.find((e) => e.id === major.eventId) as PathwayEventRecord;
      return el("majorEvent", [
        text("eventName", major.name),
        text("eventElapsedDays", event.elapsedDays),
        text("eventDate", epathDate(major.date)),
        major.start ? el("eventTimePeriod", "", { low: epathDateTime(major.start), high: epathDateTime(major.end) }) : "",
      ]);
    });
  const death = encounter ? encounterDischargeDisposition(encounter) === "exp" : false;
  return el("admission", [
    ssmix
      ? coded("clinicalDepartment", ssmix, deptName, EPATH_OID.department)
      : deptName
        ? coded("clinicalDepartment", department?.id ?? "", deptName, LOCAL_CODE_SYSTEM)
        : "",
    ...diseases,
    text("admissionDate", epathDate((admitted && encounter.period?.start) || input.application.periodStart)),
    admitted && encounter.period?.end ? text("dischargeDate", epathDate(encounter.period.end)) : "",
    text("patientDeathIndicator", death ? "Y" : "N"),
    ...majors,
  ]);
}

export function buildAppliedPathwayXml(input: AppliedPathwayXmlInput): string {
  const { application, pathway } = input;
  const events = [...application.events].sort((a, b) => a.elapsedDays - b.elapsedDays || a.pathStep - b.pathStep);
  const split = splitDays(events);
  const close = pathwayCloseValuesOf(input.applyCarePlan, input.applyGoal ?? undefined);
  const closed = application.status === "completed" || application.status === "revoked";
  const body = el("ePathMessage", [
    identification(
      { ...pathway, version: input.application.pathwayVersion || pathway.version },
      "12",
      input.facility.id,
    ),
    facility(input.facility),
    patientOf(input.patient),
    admissionOf(input, events),
    el("ePathApply", [
      el("basicInformation", [
        text("id", application.applyId),
        el("adaptiveCriteria", [text("text", application.adaptiveCriteriaText)], {
          confirmed: application.adaptiveCriteriaConfirmed ? "1" : "0",
        }),
        el("implementationPeriod", "", {
          low: epathDate(application.periodStart),
          high: closed ? epathDate(close.endDate || application.periodEnd) : "",
        }),
        application.scheduledDays !== null ? text("scheduledDays", application.scheduledDays) : "",
        closed ? text("pathEndIndicator", close.closing) : "",
      ]),
      ...events.map((event) =>
        el("event", [
          text("eventElapsedDays", event.elapsedDays),
          text("eventName", eventName(event.elapsedDays, event.title, event.pathStep, event.pathStepName, split.has(event.elapsedDays))),
          ...event.units.map((unit) => oatUnitOfApplication(unit, event.date, input)),
          compAssessmentOf(event, input),
        ]),
      ),
    ]),
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

/** ファイル名。適用は「ePath_{パスコード}_{患者番号}_{開始日}.xml」、定義は「ePath_{パスコード}_v{版}.xml」。 */
export function appliedPathwayXmlFileName(application: PathwayApplicationRecord, patient: fhir4.Patient): string {
  return `ePath_${application.pathwayCode}_${patientNumberOf(patient) ?? patient.id ?? ""}_${application.periodStart.replace(/-/g, "")}.xml`;
}

export function facilityPathwayXmlFileName(pathway: PathwayDetail): string {
  return `ePath_${pathway.pathway_code}_v${pathway.version || "1"}.xml`;
}

/** 読めるかどうかだけ確かめるための軽い検査(整形式か)。ブラウザの DOMParser を使う。 */
export function validateXml(xml: string): string | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.querySelector("parsererror");
  return error ? error.textContent : null;
}
