import { addDays } from "../lib/dates";
import { numOrNull } from "../lib/form";
import type {
  PathwayApplicationRecord,
  PathwayAssessmentRecord,
  PathwayEventRecord,
  PathwayOatUnitRecord,
} from "./pathwayApplyHelpers";
import { pathwayEventDate, phaseEventDate } from "./pathwayApplyHelpers";
import {
  eventDayOf,
  phaseLabelOf,
  sortEventsByDay,
  type PathwayDraft,
  type PathwayPhaseDraft,
  type PathwayTaskDraft,
} from "./pathwayHelpers";

// パス定義(編集中の draft)を、患者に適用する前にパスシートの形で見るためのもの。
// 適用で作る木(parsePathwayApplication の結果)と同じ形を draft から直接組み、buildPathwaySheet に渡す。
// 実日付は画面で選んだ入院日(次のフェーズの適用ではフェーズの開始日)から割り付ける。React に依存しない。

/**
 * 開始フェーズ(startPhaseKey が定義にあればそのフェーズ)から分岐をたどった経路。choices に無いフェーズは
 * 分岐の先頭(標準の経路)へ進む。「ここでパスを終了」・分岐の無いフェーズ・一度通ったフェーズで止まる。
 */
export function previewPhaseRoute(
  phases: PathwayPhaseDraft[],
  choices: Map<string, string>,
  startPhaseKey?: string,
): PathwayPhaseDraft[] {
  const route: PathwayPhaseDraft[] = [];
  let phase: PathwayPhaseDraft | undefined = phases.find((p) => p.phaseKey === startPhaseKey) ?? phases[0];
  while (phase && !route.includes(phase)) {
    route.push(phase);
    const next: string = choices.get(phase.phaseKey) ?? phase.branches[0]?.toPhaseKey ?? "";
    phase = next ? phases.find((p) => p.phaseKey === next) : undefined;
  }
  return route;
}

export interface PathwayPreview {
  application: PathwayApplicationRecord;
  /** シートのタスクのセル(procedureId)→ 元のタスク。雛形の中身を開くのに使う。 */
  tasks: Map<string, PathwayTaskDraft>;
}

/**
 * 経路上の病日を適用 1 件の木に組む。startDate は経路の先頭が開始フェーズなら入院日(病日 1)、
 * それ以外ならそのフェーズの最初の病日の日付。［決定］続くフェーズの最初の病日は前のフェーズの最終日の
 * 翌日に置く(次のフェーズの適用の既定と同じ)。病日の書式が不正な行は飛ばす。
 */
export function buildPathwayPreview(
  draft: PathwayDraft,
  startDate: string,
  route: PathwayPhaseDraft[],
): PathwayPreview {
  const tasks = new Map<string, PathwayTaskDraft>();
  const multiPhase = draft.phases.length > 1;
  const events: PathwayEventRecord[] = [];
  let nextStart = startDate;
  for (const [phaseIndex, phase] of route.entries()) {
    const phaseEvents = sortEventsByDay(draft.events).filter(
      (e) => (multiPhase ? e.phaseKey === phase.phaseKey : true) && eventDayOf(e) !== null,
    );
    const firstDay = phaseEvents.length > 0 ? (eventDayOf(phaseEvents[0]) as number) : 1;
    let lastDate = "";
    for (const event of phaseEvents) {
      const day = eventDayOf(event) as number;
      const date =
        phaseIndex === 0 && phase === draft.phases[0]
          ? pathwayEventDate(startDate, day)
          : phaseEventDate(nextStart, firstDay, day);
      lastDate = date;
      const eventId = `preview-event-${event.key}`;
      events.push({
        id: eventId,
        elapsedDays: day,
        pathStep: event.pathStep,
        pathStepName: event.pathStepName.trim(),
        title: event.title.trim(),
        date,
        phaseKey: phase.phaseKey,
        phaseName: multiPhase ? phaseLabelOf(draft.phases, phase.phaseKey) : "",
        phaseNote: "",
        units: event.oatUnits.map((unit): PathwayOatUnitRecord => {
          const unitId = `${eventId}-unit-${unit.key}`;
          const assessmentKeys = new Set(unit.assessments.map((a) => a.assessmentKey));
          // 観察項目に結んでいないタスクは、適用と同じく「観察項目なし」(名前の無い観察項目)で包む。
          const looseTasks = unit.tasks.filter((t) => !t.assessmentKey || !assessmentKeys.has(t.assessmentKey));
          const assessments: PathwayAssessmentRecord[] = [
            ...unit.assessments.map((a) => ({
              key: a.assessmentKey,
              name: a.name.trim(),
              properValue: a.properValue.trim(),
              tasks: unit.tasks.filter((t) => t.assessmentKey === a.assessmentKey),
            })),
            ...(looseTasks.length > 0 ? [{ key: "", name: "", properValue: "", tasks: looseTasks }] : []),
          ].map((row, index) => {
            const assessmentId = `${unitId}-assessment-${index}`;
            return {
              id: assessmentId,
              assessmentKey: row.key,
              name: row.name,
              codings: [],
              nursingObservationManageNo: "",
              properValue: row.properValue,
              tasks: row.tasks.map((task) => {
                const id = `${assessmentId}-task-${task.key}`;
                tasks.set(id, task);
                return {
                  id,
                  taskKey: task.taskKey,
                  orderIds: [],
                  name: task.name.trim() || "(名称未入力)",
                  categoryLv1: task.categoryLv1,
                  categoryLv2: task.categoryLv2,
                  performedDateTime: null,
                  plannedDate: date,
                  done: false,
                };
              }),
            };
          });
          return {
            id: unitId,
            unitKey: unit.unitKey,
            unitId,
            name: unit.name.trim() || "(名称未入力)",
            critical: unit.critical,
            unplanned: false,
            assessments,
          };
        }),
      });
    }
    if (lastDate) nextStart = addDays(lastDate, 1);
  }

  const application: PathwayApplicationRecord = {
    id: "preview",
    applyId: "",
    title: draft.name.trim(),
    status: "active",
    pathwayCode: draft.pathwayCode,
    periodStart: events[0]?.date ?? startDate,
    periodEnd: "",
    encounterId: "",
    scheduledDays: numOrNull(draft.scheduledDays),
    adaptiveCriteriaText: draft.adaptiveCriteria,
    adaptiveCriteriaConfirmed: false,
    events,
  };
  return { application, tasks };
}
