import { createTaskHelpers } from "./taskHelpers";

// 病理検査の進捗。検体検査(labTaskHelpers)・放射線検査と同じ考え方で、
// オーダーの ServiceRequest はそのままにして、進捗を Task で別に持つ。
//
//   ServiceRequest(オーダー) ← focus ── Task(進捗)
//
// Task は最初のステータス変更(受付・中止)で作る。オーダー登録時には作らないので、
// 一覧では「Task が無い = 依頼済(未受付)」として扱う。
//
// 検体検査と違って検体ラベルの発行・スキャンを持たないため(今回は見送り。
// docs/patho-order-design.md §8)、受付済・検査済は一覧のボタンで直接進める。

export const PATHO_TASK_CODE = { code: "patho-exam", display: "病理検査" };

/**
 * 病理検査の進捗。
 *
 * requested … 依頼済(病理部門はまだ検体を受け取っていない)
 * accepted  … 受付済(検体が病理部門に届いた)
 * completed … 検査済(標本作製から診断まで終わった)
 * cancelled … 中止
 */
export type PathoTaskStatus = "requested" | "accepted" | "completed" | "cancelled";

export const PATHO_TASK_STATUS_OPTIONS: { code: PathoTaskStatus; display: string }[] = [
  { code: "requested", display: "依頼済" },
  { code: "accepted", display: "受付済" },
  { code: "completed", display: "検査済" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<PathoTaskStatus>({
  taskCode: PATHO_TASK_CODE,
  statusOptions: PATHO_TASK_STATUS_OPTIONS,
});

export const pathoTaskStatusDisplay = helpers.statusDisplay;

/** 一覧の行から押せる操作。検体検査の LabTaskAction と同じ形。 */
export interface PathoTaskAction {
  label: string;
  next: PathoTaskStatus;
  /** 日常の流れではない操作(押し間違いの訂正・検査の取りやめ)。ケバブメニューに畳む。 */
  secondary?: true;
}

/**
 * 今のステータスから移れる先。
 *
 * 「取消」は 1 つ前に戻す訂正、「中止」は検査そのものの取りやめ(検体検査・放射線と
 * 同じ区別)。検体受領と検査完了はこの一覧のボタンが唯一の入口なので主ボタンにする。
 */
export function pathoTaskActions(status: PathoTaskStatus): PathoTaskAction[] {
  switch (status) {
    case "requested":
      return [
        { label: "受付済にする", next: "accepted" },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "accepted":
      return [
        { label: "検査済にする", next: "completed" },
        { label: "取消", next: "requested", secondary: true },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "completed":
      return [{ label: "取消", next: "accepted", secondary: true }];
    case "cancelled":
      return [{ label: "中止を取消", next: "requested", secondary: true }];
  }
}

/** Task が病理検査の進捗かどうか。他部門との振り分けに使う。 */
export const isPathoTask = helpers.isTask;

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export const pathoTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const pathoTasksByOrderId = helpers.tasksByOrderId;

/**
 * ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照。
 * executionPeriod は受付で start、検査済で end)。
 */
export const buildPathoTaskUpdate = helpers.buildTaskUpdate;
