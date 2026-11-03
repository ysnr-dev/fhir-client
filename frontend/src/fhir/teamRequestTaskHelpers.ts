import {
  NOTIFICATION_TEAM_EXT_URL,
  notificationTeamOf,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";
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
//
// 進捗 Task は依頼の登録と同時に作り、宛先(owner)を依頼先のチームにする。依頼済のあいだは
// チームあての通知としてメンバー全員のベルに出て、誰かが受付・却下すると消える
// (notificationHelpers の「チームあて」)。一覧に出す依頼目的・希望日は Task 自身に写す。

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

const DESIRED_DATE_INPUT = "希望日";

/** 依頼先のチーム(ServiceRequest.performer の CareTeam)。 */
function orderTeam(order: fhir4.ServiceRequest): fhir4.Reference | undefined {
  const team = order.performer?.find((p) => p.reference?.startsWith("CareTeam/"));
  return team ? { reference: team.reference, ...(team.display ? { display: team.display } : {}) } : undefined;
}

/**
 * ステータスを変えた Task。まだ無ければ作る。却下の理由は Task.statusReason.text に持ち、
 * 却下以外へ動かすときは外す。宛先は依頼先のチームで、メンバーが引受けていればその人のまま。
 * orderReference は登録と同じ Bundle で作るとき(ヘッダの fullUrl)に渡す。
 */
export function buildTeamRequestTaskUpdate(
  task: fhir4.Task | undefined,
  order: fhir4.ServiceRequest,
  status: TeamRequestTaskStatus,
  reason?: string,
  orderReference?: string,
): fhir4.Task {
  const next = withTeamRequestTaskContent(helpers.buildTaskUpdate(task, order, status, orderReference), order);
  if (status === "cancelled" && reason?.trim()) next.statusReason = { text: reason.trim() };
  else delete next.statusReason;
  return next;
}

/**
 * 依頼の内容(宛先のチーム・依頼目的・希望日)を Task に写す。依頼先のチームが変わったら
 * 引受けを外して新しいチームあてにする。
 */
export function withTeamRequestTaskContent(task: fhir4.Task, order: fhir4.ServiceRequest): fhir4.Task {
  const next: fhir4.Task = { ...task };
  const team = orderTeam(order);
  if (team && notificationTeamOf(task)?.reference !== team.reference) {
    next.owner = team;
    const extensions = (task.extension ?? []).filter((e) => e.url !== NOTIFICATION_TEAM_EXT_URL);
    if (extensions.length > 0) next.extension = extensions;
    else delete next.extension;
  } else if (team && !task.owner) {
    next.owner = team;
  }
  const purpose = order.reasonCode?.[0]?.text?.trim();
  if (purpose) next.description = purpose;
  else delete next.description;
  const desiredDate = order.occurrenceDateTime?.slice(0, 10);
  const inputs = (task.input ?? []).filter((input) => input.type?.text !== DESIRED_DATE_INPUT);
  next.input = desiredDate
    ? [...inputs, { type: { text: DESIRED_DATE_INPUT }, valueDate: desiredDate }]
    : inputs;
  if (next.input.length === 0) delete next.input;
  return next;
}

/** 通知の一覧の行。 */
export interface TeamRequestNotificationRow extends NotificationRowBase {
  orderId: string;
  desiredDate: string;
  purpose: string;
}

export function teamRequestNotificationRowOf(
  task: fhir4.Task,
  patient: fhir4.Patient | undefined,
): TeamRequestNotificationRow {
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    orderId: task.focus?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1] ?? "",
    desiredDate: taskInputOf(task, DESIRED_DATE_INPUT)?.valueDate ?? "",
    purpose: task.description ?? "",
  };
}

/** 却下の理由(Task.statusReason.text)。 */
export function teamRequestCancelReason(task: fhir4.Task | undefined): string {
  return task?.status === "cancelled" ? (task.statusReason?.text ?? "") : "";
}
