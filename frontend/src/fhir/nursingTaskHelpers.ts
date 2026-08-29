import { createTaskHelpers } from "./taskHelpers";

// 看護指示の Task = 看護師の「指示受け」。
//
//   ServiceRequest(指示 1 行) ← focus ── Task(指示受け)
//
// 他部門の Task が「部門の作業の進捗」なのに対し、看護指示では「看護師がその指示を
// 確認して受けたか」を表す。指示 1 行に Task 1 つで、指示の登録と同時に requested で
// 作り(指示受け待ち)、看護師がまとめて accepted にする。受けた人は Task.owner。
//
//   requested … 指示受け待ち
//   accepted  … 指示受け済
//   cancelled … 中止(指示が取り下げられた)
//
// 指示の終了(終了日到来)では Task を動かさない。指示簿は SR 側の終了日で判定する。

export const NURSING_TASK_CODE = { code: "nursing", display: "看護指示" };

export type NursingTaskStatus = "requested" | "accepted" | "cancelled";

export const NURSING_TASK_STATUS_OPTIONS: { code: NursingTaskStatus; display: string }[] = [
  { code: "requested", display: "指示受け待ち" },
  { code: "accepted", display: "指示受け済" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<NursingTaskStatus>({
  taskCode: NURSING_TASK_CODE,
  statusOptions: NURSING_TASK_STATUS_OPTIONS,
});

export const isNursingTask = helpers.isTask;
export const nursingTaskStatus = helpers.taskStatus;
export const nursingTaskStatusDisplay = helpers.statusDisplay;
export const nursingTasksByOrderId = helpers.tasksByOrderId;
export const buildNursingTaskUpdate = helpers.buildTaskUpdate;

/** 指示受けをした人。taskHelpers は owner を扱わないので後から載せる。 */
export function withTaskOwner(
  task: fhir4.Task,
  owner: { practitionerId: string; display: string },
): fhir4.Task {
  return {
    ...task,
    owner: {
      reference: `Practitioner/${owner.practitionerId}`,
      ...(owner.display ? { display: owner.display } : {}),
    },
  };
}

/** Task の書き込み用エントリ。まだ id が無い(新規)なら POST、あれば PUT。 */
export function nursingTaskEntry(task: fhir4.Task): fhir4.BundleEntry {
  return {
    resource: task,
    request: task.id ? { method: "PUT", url: `Task/${task.id}` } : { method: "POST", url: "Task" },
  };
}

/** 指示受けした人の表示名(owner.display)。 */
export function nursingTaskOwnerName(task: fhir4.Task | undefined): string {
  return task?.owner?.display ?? "";
}
