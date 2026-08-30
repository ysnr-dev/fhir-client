import { createTaskHelpers } from "./taskHelpers";

// 他科依頼の進捗。作りは他部門と同じ「ServiceRequest ← focus ── Task」だが、
// **Task の遷移と同じ transaction で ServiceRequest.status も動かす**点だけが違う
// (docs/consult-order-design.md §4)。
//
//   Task requested (依頼済)  ↔ SR.status active
//   Task accepted  (対応中)  ↔ SR.status active
//   Task completed (回答済)  ↔ SR.status completed
//   Task cancelled (取消)    ↔ SR.status revoked
//
// 他科依頼は日付軸を持たない(希望日は任意入力)ので、部門一覧が「未回答だけ」を
// サーバー側で絞る手段が status しか無い。リハビリが Task の終了と一緒に
// ServiceRequest へ終了日を書いたのと同じ事情(docs/rehab-order-design.md §6.1)。
//
// **表示の正本は Task**(依頼済と対応中を status では区別できないため)。status は
// 検索のための索引。片方だけを動かす実装を書かないこと — 書き込みの入口は
// api/queries.ts の useUpdateConsultTaskStatus と useSaveConsultReply だけにする。

export const CONSULT_TASK_CODE = { code: "consult", display: "他科依頼" };

/** 他科依頼の進捗(= 依頼先科の対応状況)。 */
export type ConsultTaskStatus = "requested" | "accepted" | "completed" | "cancelled";

export const CONSULT_TASK_STATUS_OPTIONS: { code: ConsultTaskStatus; display: string }[] = [
  { code: "requested", display: "依頼済" },
  // 他部門の「受付済」に当たる。回答を書くまでの間の状態なので「対応中」と出す。
  { code: "accepted", display: "対応中" },
  { code: "completed", display: "回答済" },
  { code: "cancelled", display: "取消" },
];

const helpers = createTaskHelpers<ConsultTaskStatus>({
  taskCode: CONSULT_TASK_CODE,
  statusOptions: CONSULT_TASK_STATUS_OPTIONS,
});

export const consultTaskStatusDisplay = helpers.statusDisplay;

/** ServiceRequest.status のうち、その進捗に対応するもの(§4)。 */
export function consultOrderStatusFor(
  status: ConsultTaskStatus,
): fhir4.ServiceRequest["status"] {
  if (status === "completed") return "completed";
  // 依頼先科が「対応不要」として閉じた依頼。FHIR の revoked(取り下げられた依頼)。
  if (status === "cancelled") return "revoked";
  return "active";
}

/** 一覧の行から押せる操作。他部門の *TaskAction と同じ形。 */
export interface ConsultTaskAction {
  label: string;
  next: ConsultTaskStatus;
  /** 日常の流れではない操作(押し間違いの訂正)。ケバブメニューに畳む。 */
  secondary?: true;
}

/**
 * 今のステータスから移れる先。
 *
 * 「回答」は状態を選ぶ操作ではなく診療記録を書く操作なので、ここには出さない
 * (一覧の行から回答モーダルを開き、保存で completed になる)。ここに出るのは
 * 受付と取消、それに押し間違いの訂正だけ。
 *
 * 「回答取消」で対応中へ戻すと、依頼から回答への参照も外れる(回答の診療記録
 * そのものは消さない。docs/consult-order-design.md §7)。
 */
export function consultTaskActions(status: ConsultTaskStatus): ConsultTaskAction[] {
  switch (status) {
    case "requested":
      return [
        { label: "受付", next: "accepted" },
        { label: "取消", next: "cancelled", secondary: true },
      ];
    case "accepted":
      return [
        { label: "受付取消", next: "requested", secondary: true },
        { label: "取消", next: "cancelled", secondary: true },
      ];
    case "completed":
      return [{ label: "回答取消", next: "accepted", secondary: true }];
    case "cancelled":
      return [{ label: "取消を戻す", next: "requested", secondary: true }];
  }
}

/** Task が他科依頼の進捗かどうか。他部門との振り分けに使う。 */
export const isConsultTask = helpers.isTask;

/** 進捗。Task がまだ無いオーダー(依頼先科が触っていない)は依頼済。 */
export const consultTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const consultTasksByOrderId = helpers.tasksByOrderId;

/**
 * ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照)。
 * executionPeriod は受付で start、回答で end。
 */
export const buildConsultTaskUpdate = helpers.buildTaskUpdate;
