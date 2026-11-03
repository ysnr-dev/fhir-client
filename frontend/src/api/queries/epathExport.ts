import { useMutation } from "@tanstack/react-query";
import { fetchPathway } from "../masterClient";
import { readResource, searchResource } from "../fhirClient";
import {
  appliedPathwayXmlFileName,
  buildAppliedPathwayXml,
  validateXml,
  type EpathFacility,
  type TaskPerform,
} from "../../fhir/epathMessageHelpers";
import type { PathwayTaskRecord } from "../../fhir/pathwayApplyHelpers";
import { buildEvaluationState } from "../../fhir/pathwayEvaluationHelpers";
import { pathwayMajorEvents } from "../../fhir/pathwayMajorEventHelpers";
import { isOrderDrivenTask, nursingPerformDates, pathwayTaskPerformedOn } from "../../fhir/pathwaySheetHelpers";
import { fetchNursingPerforms } from "./nursing";
import { PATHWAY_APPLY_GOAL_ID_SYSTEM } from "../../fhir/pathwayCloseHelpers";
import { parsePractitionerRole, baseRoleOf } from "../../fhir/practitionerRoleHelpers";
import { PATHWAY_MARKER_CODE, PATHWAY_MARKER_SYSTEM } from "../../fhir/pathwayApplyHelpers";
import { resourcesOfType } from "../../fhir/shared";
import { downloadBlob } from "../../lib/download";
import { fetchPathwayApplicationTree } from "./pathway";

// ePath メッセージ(適用後パスデータ)の出力。パスタブの操作から 1 適用を XML ファイルにする。
// 材料(適用の木・評価・患者・入院・病名・記録者の職種)は押したときに読み、
// 組み立ては fhir/epathMessageHelpers.ts(純粋関数)に任せる。docs/clinical-pathway-design.md §7.14。

export interface EpathExportInput {
  applyId: string;
  patientId: string;
  facility: EpathFacility;
}

/** 記録者(評価・実績・タスクの performer)の職種を、PractitionerRole をまとめて 1 回引いて揃える。 */
async function fetchJobCodes(practitionerIds: string[]): Promise<Map<string, string>> {
  const jobs = new Map<string, string>();
  if (practitionerIds.length === 0) return jobs;
  const params = new URLSearchParams();
  params.set("practitioner", practitionerIds.map((id) => `Practitioner/${id}`).join(","));
  params.set("_count", "500");
  const { data } = await searchResource<fhir4.PractitionerRole>("PractitionerRole", params);
  const byPractitioner = new Map<string, fhir4.PractitionerRole[]>();
  for (const role of resourcesOfType<fhir4.PractitionerRole>(data, "PractitionerRole")) {
    const id = role.practitioner?.reference?.split("/").pop() ?? "";
    byPractitioner.set(id, [...(byPractitioner.get(id) ?? []), role]);
  }
  for (const [id, roles] of byPractitioner) {
    const base = baseRoleOf(roles);
    if (base) jobs.set(id, parsePractitionerRole(base).roleCode);
  }
  return jobs;
}

/** 評価・実績(Observation.performer)とタスク(Procedure.performer.actor)の記録者の Practitioner id。 */
function performerIds(observations: fhir4.Observation[], procedures: fhir4.Procedure[]): string[] {
  const references = [
    ...observations.flatMap((o) => (o.performer ?? []).map((p) => p.reference)),
    ...procedures.flatMap((p) => (p.performer ?? []).map((x) => x.actor?.reference)),
  ];
  const ids = new Set<string>();
  for (const reference of references) {
    if (reference?.startsWith("Practitioner/")) ids.add(reference.slice("Practitioner/".length));
  }
  return [...ids];
}

export async function exportAppliedPathwayXml(input: EpathExportInput): Promise<{ fileName: string; xml: string }> {
  const tree = await fetchPathwayApplicationTree(input.applyId);
  const application = tree.application;
  if (!application) throw new Error("適用が読めません");
  const applyCarePlan = tree.carePlans.get(application.id);
  if (!applyCarePlan) throw new Error("適用の CarePlan が読めません");

  const observationParams = new URLSearchParams();
  observationParams.set("patient", `Patient/${input.patientId}`);
  observationParams.set("category", `${PATHWAY_MARKER_SYSTEM}|${PATHWAY_MARKER_CODE}`);
  observationParams.set("_count", "500");
  const goalParams = new URLSearchParams();
  goalParams.set("identifier", `${PATHWAY_APPLY_GOAL_ID_SYSTEM}|${application.applyId}`);

  const [pathway, patient, observationBundle, goalBundle, encounter] = await Promise.all([
    fetchPathway(application.pathwayCode),
    readResource<fhir4.Patient>("Patient", input.patientId).then((r) => r.data),
    searchResource<fhir4.Observation>("Observation", observationParams).then((r) => r.data),
    searchResource<fhir4.Goal>("Goal", goalParams).then((r) => r.data),
    application.encounterId
      ? readResource<fhir4.Encounter>("Encounter", application.encounterId).then((r) => r.data)
      : Promise.resolve(null),
  ]);
  const observations = resourcesOfType<fhir4.Observation>(observationBundle, "Observation");
  const evaluation = buildEvaluationState(observations, tree.goals, [...tree.carePlans.values()]);
  const applyGoal = resourcesOfType<fhir4.Goal>(goalBundle, "Goal")[0] ?? null;

  const departmentId = encounter?.serviceProvider?.reference?.split("/").pop();
  const conditionIds = (applyCarePlan.addresses ?? []).map((ref) => ref.reference?.split("/").pop()).filter(Boolean) as string[];
  const [department, conditions, jobs, nursingPerforms] = await Promise.all([
    departmentId ? readResource<fhir4.Organization>("Organization", departmentId).then((r) => r.data) : Promise.resolve(null),
    Promise.all(conditionIds.map((id) => readResource<fhir4.Condition>("Condition", id).then((r) => r.data))),
    fetchJobCodes(performerIds(observations, [...tree.procedures.values(), ...tree.performs])),
    fetchNursingPerforms((params) => params.set("patient", `Patient/${input.patientId}`)),
  ]);
  const performDates = nursingPerformDates(nursingPerforms);
  // オーダーの実施記録(本体)をオーダーごとに。日時と実施者を出すのに使う。
  const performHubs = new Map<string, fhir4.Procedure[]>();
  for (const procedure of tree.performs) {
    if (procedure.partOf?.length || procedure.status === "entered-in-error" || procedure.status === "not-done") continue;
    for (const ref of procedure.basedOn ?? []) {
      const id = ref.reference?.split("/").pop() ?? "";
      if (ref.reference?.startsWith("ServiceRequest/")) performHubs.set(id, [...(performHubs.get(id) ?? []), procedure]);
    }
  }
  const taskPerformOf = (task: PathwayTaskRecord, date: string): TaskPerform => {
    const done = pathwayTaskPerformedOn(task, date, tree.orders, performDates, tree.orderProgress);
    if (!done) return { done: false, at: "", performer: undefined };
    const procedure = tree.procedures.get(task.id);
    if (!isOrderDrivenTask(task, tree.orders, tree.orderProgress) || task.done) {
      return { done: true, at: task.performedDateTime ?? "", performer: procedure?.performer?.[0]?.actor };
    }
    // オーダーの実施記録のうち、その日のもの(無ければ最初のもの)。看護指示は記録が Observation なので日時だけ。
    const hubs = task.orderIds.flatMap((id) => performHubs.get(id) ?? []);
    const startOf = (p: fhir4.Procedure) => p.performedPeriod?.start ?? p.performedDateTime ?? "";
    const hub = hubs.find((p) => startOf(p).startsWith(date)) ?? hubs[0];
    if (hub) return { done: true, at: startOf(hub), performer: hub.performer?.[0]?.actor };
    const nursing = task.orderIds.flatMap((id) => nursingPerforms.get(id) ?? []).find((row) => row.at.startsWith(date));
    return { done: true, at: nursing?.at ?? "", performer: undefined };
  };

  const xml = buildAppliedPathwayXml({
    pathway,
    application,
    carePlans: tree.carePlans,
    procedures: tree.procedures,
    orders: tree.orders,
    evaluation,
    applyGoal,
    applyCarePlan,
    majorEvents: pathwayMajorEvents(application, tree.performs),
    facility: input.facility,
    patient,
    encounter,
    department,
    conditions,
    jobOf: (id) => jobs.get(id) ?? "",
    taskPerformOf,
  });
  const error = validateXml(xml);
  if (error) throw new Error(`XML の組み立てに失敗しました: ${error}`);
  return { fileName: appliedPathwayXmlFileName(application, patient), xml };
}

/** ePath メッセージを組んでダウンロードさせる。 */
export function useExportAppliedPathwayXml() {
  return useMutation({
    mutationFn: async (input: EpathExportInput) => {
      const { fileName, xml } = await exportAppliedPathwayXml(input);
      downloadBlob(new Blob([xml], { type: "application/xml" }), fileName);
      return fileName;
    },
  });
}
