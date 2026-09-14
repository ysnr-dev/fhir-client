import {
  PATHWAY_CODE_SYSTEM,
  PATHWAY_DISPLAY_ORDER_EXT_URL,
  PATHWAY_EXT,
  PATHWAY_LEVEL_SYSTEM,
  type PathwayLevel,
} from "./pathwayApplyHelpers";
import { eventDayStepLabel } from "./pathwayHelpers";

// 病棟の指示簿に出す「パスのタスク」。その日の病日に置かれた、オーダーを持たないタスク
// (チェックリスト: 観察・説明・文書など)を患者ごとに並べる。オーダー雛形から出したタスクは
// 看護指示・各部門のオーダーとして別の画面に出るので含めない。React に依存しない。
// 設計は docs/clinical-pathway-design.md §6(看護の指示簿)。

export interface PathwayWardTask {
  procedure: fhir4.Procedure;
  patientId: string;
  /** 適用(木の根)の CarePlan の id とパス名。 */
  applyId: string;
  applyTitle: string;
  /** 病日の CarePlan の id と見出し(「病日 3 術後1日目」)。 */
  eventId: string;
  eventLabel: string;
  unitName: string;
  name: string;
  categoryLv1: string;
  categoryLv2: string;
  done: boolean;
  performedDateTime: string;
  performerName: string;
}

function levelOf(carePlan: fhir4.CarePlan): PathwayLevel | null {
  const code = carePlan.category
    ?.flatMap((c) => c.coding ?? [])
    .find((c) => c.system === PATHWAY_LEVEL_SYSTEM)?.code;
  return (code as PathwayLevel | undefined) ?? null;
}

function lastPartOfId(carePlan: fhir4.CarePlan): string {
  return carePlan.partOf?.at(-1)?.reference?.split("/").pop() ?? "";
}

function firstPartOfId(carePlan: fhir4.CarePlan): string {
  return carePlan.partOf?.[0]?.reference?.split("/").pop() ?? "";
}

function intExt(resource: { extension?: fhir4.Extension[] }, url: string): number | null {
  const value = resource.extension?.find((e) => e.url === url)?.valueInteger;
  return typeof value === "number" ? value : null;
}

function orderOf(resource: { extension?: fhir4.Extension[] }): number {
  return intExt(resource, PATHWAY_DISPLAY_ORDER_EXT_URL) ?? 9999;
}

/**
 * その日の病日の CarePlan・適用・子孫(OAT ユニット・観察項目)・タスクの Procedure から、オーダーを持たない
 * タスクを組む。［決定］進行中の適用だけを出す(終了・中止したパスのタスクは仕事として残さない)。
 * 並びは患者ごとに 病日 → アウトカム → タスク の表示順。
 */
export function parsePathwayWardTasks(
  resources: fhir4.Resource[],
): PathwayWardTask[] {
  const carePlans = resources.filter((r): r is fhir4.CarePlan => r.resourceType === "CarePlan" && Boolean(r.id));
  const procedures = resources.filter((r): r is fhir4.Procedure => r.resourceType === "Procedure");
  const byId = new Map(carePlans.map((cp) => [cp.id as string, cp]));

  const tasks: (PathwayWardTask & { sortKey: number[] })[] = [];
  for (const procedure of procedures) {
    const refs = procedure.basedOn ?? [];
    if (refs.some((ref) => ref.reference?.startsWith("ServiceRequest/"))) continue;
    const assessment = byId.get(refs.find((ref) => ref.reference?.startsWith("CarePlan/"))?.reference?.split("/").pop() ?? "");
    if (!assessment || levelOf(assessment) !== "assessment") continue;
    const unit = byId.get(lastPartOfId(assessment));
    const apply = byId.get(firstPartOfId(assessment));
    const event = unit ? byId.get(lastPartOfId(unit)) : undefined;
    if (!unit || !apply || !event || apply.status !== "active") continue;

    const elapsedDays = intExt(event, PATHWAY_EXT.eventElapsedDays) ?? 0;
    const pathStep = intExt(event, PATHWAY_EXT.pathStep) ?? 1;
    const pathStepName = event.extension?.find((e) => e.url === PATHWAY_EXT.pathStepName)?.valueString ?? "";
    const coding = procedure.category?.coding ?? [];
    tasks.push({
      procedure,
      patientId: procedure.subject?.reference?.split("/").pop() ?? "",
      applyId: apply.id as string,
      applyTitle: apply.title ?? "",
      eventId: event.id as string,
      eventLabel: `病日 ${elapsedDays} ${eventDayStepLabel(elapsedDays, event.title, pathStep, pathStepName)}`,
      unitName: unit.title ?? "",
      name: procedure.code?.text ?? "",
      categoryLv1: coding.find((c) => c.system === PATHWAY_CODE_SYSTEM.taskCategoryLv1)?.code ?? "",
      categoryLv2: coding.find((c) => c.system === PATHWAY_CODE_SYSTEM.taskCategoryLv2)?.code ?? "",
      done: procedure.status === "completed",
      performedDateTime: procedure.performedDateTime ?? "",
      performerName: procedure.performer?.[0]?.actor?.display ?? "",
      sortKey: [elapsedDays, pathStep, orderOf(unit), orderOf(assessment), orderOf(procedure)],
    });
  }
  tasks.sort((a, b) => {
    for (let i = 0; i < a.sortKey.length; i++) {
      if (a.sortKey[i] !== b.sortKey[i]) return a.sortKey[i] - b.sortKey[i];
    }
    return 0;
  });
  return tasks.map(({ sortKey: _sortKey, ...task }) => task);
}
