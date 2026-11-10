import { createTaskHelpers } from "./taskHelpers";

// 透析の進捗。Task の意味はリハビリと同じ「部門の受け入れ状態」で、日々の実施では動かさない
// (rehabTaskHelpers.ts の冒頭、docs/dialysis-order-design.md §4.1)。
//
//   requested … 依頼済(透析室がまだ受けていない)
//   accepted  … 受付済(= 実施中。期間中ずっとこの状態で、予約の展開と実施はこの状態でだけ行う)
//   completed … 終了(期間を打ち切った。オーダーに終了日も書く)
//   cancelled … 中止

export const DIALYSIS_TASK_CODE = { code: "dialysis", display: "透析" };

export type DialysisTaskStatus = "requested" | "accepted" | "completed" | "cancelled";

export const DIALYSIS_TASK_STATUS_OPTIONS: { code: DialysisTaskStatus; display: string }[] = [
  { code: "requested", display: "依頼済" },
  // 期間中ずっとこの状態で実施が積み上がるので、待ち行列と誤解されないよう「実施中」と出す。
  { code: "accepted", display: "実施中" },
  { code: "completed", display: "終了" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<DialysisTaskStatus>({
  taskCode: DIALYSIS_TASK_CODE,
  statusOptions: DIALYSIS_TASK_STATUS_OPTIONS,
});

export const dialysisTaskStatusDisplay = helpers.statusDisplay;

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export const dialysisTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const dialysisTasksByOrderId = helpers.tasksByOrderId;

/** ステータスを変えた Task。まだ無ければ作る。 */
export const buildDialysisTaskUpdate = helpers.buildTaskUpdate;

export interface DialysisTaskAction {
  label: string;
  next: DialysisTaskStatus;
  /** 日常の流れではない操作(押し間違いの訂正・取りやめ)。ケバブメニューに畳む。 */
  secondary?: true;
}

/**
 * 今のステータスから移れる先(リハビリの rehabTaskActions と同じ表)。
 * 終了はオーダーに終了日を書く(buildDialysisOrderCloseEntry)。終了取消は Task だけを戻し、終了日は消さない。
 */
export function dialysisTaskActions(status: DialysisTaskStatus): DialysisTaskAction[] {
  switch (status) {
    case "requested":
      return [
        { label: "受付", next: "accepted" },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "accepted":
      return [
        { label: "終了", next: "completed", secondary: true },
        { label: "受付取消", next: "requested", secondary: true },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "completed":
      return [{ label: "終了取消", next: "accepted", secondary: true }];
    case "cancelled":
      return [{ label: "中止取消", next: "requested", secondary: true }];
  }
}
