import { createTaskHelpers } from "./taskHelpers";

// チーム依頼の進捗(docs/care-team-design.md §2)。他科依頼と同じく **Task の遷移と同じ transaction で
// ServiceRequest.status も動かす**(日付軸を持たない依頼を、ワークリストが status で絞るため)。
//
//   Task requested (依頼済)  ↔ SR.status active
//   Task accepted  (介入中)  ↔ SR.status active
//   Task completed (終了)    ↔ SR.status completed
//   Task cancelled (却下)    ↔ SR.status revoked   … 理由を Task.statusReason.text に持つ
//
// 他科依頼との違いは「回答で完了」しないこと。回診記録は何度書いても介入中のままで、
// 終了はチームが明示する。書き込みの入口は api/queries/teamRequest.ts の
// useUpdateTeamRequestTaskStatus と useSaveTeamRound だけにする。

export const TEAM_REQUEST_TASK_CODE = { code: "team-request", display: "チーム依頼" };

export type TeamRequestTaskStatus = "requested" | "accepted" | "completed" | "cancelled";

export const TEAM_REQUEST_TASK_STATUS_OPTIONS: { code: TeamRequestTaskStatus; display: string }[] = [
  { code: "requested", display: "依頼済" },
  { code: "accepted", display: "介入中" },
  { code: "completed", display: "終了" },
  { code: "cancelled", display: "却下" },
];

const helpers = createTaskHelpers<TeamRequestTaskStatus>({
  taskCode: TEAM_REQUEST_TASK_CODE,
  statusOptions: TEAM_REQUEST_TASK_STATUS_OPTIONS,
});

export const teamRequestTaskStatusDisplay = helpers.statusDisplay;

/** ServiceRequest.status のうち、その進捗に対応するもの。 */
export function teamRequestOrderStatusFor(status: TeamRequestTaskStatus): fhir4.ServiceRequest["status"] {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "revoked";
  return "active";
}

export interface TeamRequestTaskAction {
  label: string;
  next: TeamRequestTaskStatus;
  /** 日常の流れではない操作(押し間違いの訂正)。ケバブメニューに畳む。 */
  secondary?: true;
  /** 理由の入力を求める(却下)。 */
  reason?: true;
}

/**
 * 今のステータスから移れる先。「回診記録」は状態を選ぶ操作ではなく診療記録を書く操作なので
 * ここには出さない(保存で依頼済なら介入中になる)。
 */
export function teamRequestTaskActions(status: TeamRequestTaskStatus): TeamRequestTaskAction[] {
  switch (status) {
    case "requested":
      return [
        { label: "受付", next: "accepted" },
        { label: "却下", next: "cancelled", secondary: true, reason: true },
      ];
    case "accepted":
      return [
        { label: "終了", next: "completed" },
        { label: "受付取消", next: "requested", secondary: true },
        { label: "却下", next: "cancelled", secondary: true, reason: true },
      ];
    case "completed":
      return [{ label: "終了取消", next: "accepted", secondary: true }];
    case "cancelled":
      return [{ label: "却下戻し", next: "requested", secondary: true }];
  }
}

/** 進捗。Task がまだ無い依頼(チームが触っていない)は依頼済。 */
export const teamRequestTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const teamRequestTasksByOrderId = helpers.tasksByOrderId;

/**
 * ステータスを変えた Task。まだ無ければ作る。却下の理由は Task.statusReason.text に持ち、
 * 却下以外へ動かすときは外す。
 */
export function buildTeamRequestTaskUpdate(
  task: fhir4.Task | undefined,
  order: fhir4.ServiceRequest,
  status: TeamRequestTaskStatus,
  reason?: string,
): fhir4.Task {
  const next = helpers.buildTaskUpdate(task, order, status);
  if (status === "cancelled" && reason?.trim()) next.statusReason = { text: reason.trim() };
  else delete next.statusReason;
  return next;
}

/** 却下の理由(Task.statusReason.text)。 */
export function teamRequestCancelReason(task: fhir4.Task | undefined): string {
  return task?.status === "cancelled" ? (task.statusReason?.text ?? "") : "";
}
