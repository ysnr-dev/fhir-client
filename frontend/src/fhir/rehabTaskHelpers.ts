import { createTaskHelpers } from "./taskHelpers";

// リハビリの進捗。オーダーそのものは ServiceRequest のままにして、「その依頼がリハ
// 部門でどこまで進んだか」を Task で別に持つ形は他部門と同じ。
//
//   ServiceRequest(オーダー) ← focus ── Task(進捗)
//
// ただし **Task の意味が他部門と違う**(docs/rehab-order-design.md §4)。
//
// 他部門の Task は「1 回の作業の進捗」で、実施したら completed になる。リハビリは
// 1 つのオーダーが数週間〜数か月続き、その間に実施が何度も積み上がるので、同じにすると
// 初日の実施で completed になり 2 日目以降が実施できなくなる。
//
// そこでリハビリの Task は **部門の受け入れ状態** を表す:
//
//   requested … 依頼済(リハ科がまだ受けていない)
//   accepted  … 受付済(受けた = 実施中。期間中ずっとこの状態)
//   completed … 終了(期間が終わった)
//   cancelled … 中止
//
// 日々の実施は Task を動かさず Procedure を追加するだけ(rehabResultHelpers.ts の
// buildRehabPerformBundle)。**この逸脱は他部門の実施入力と作りが違う唯一の点**なので、
// 部門一覧の実施ボタンを他部門と同じ形に「揃える」リファクタをしてはいけない。

export const REHAB_TASK_CODE = { code: "rehab", display: "リハビリ" };

/** リハビリの進捗(= リハ部門の受け入れ状態)。 */
export type RehabTaskStatus = "requested" | "accepted" | "completed" | "cancelled";

export const REHAB_TASK_STATUS_OPTIONS: { code: RehabTaskStatus; display: string }[] = [
  { code: "requested", display: "依頼済" },
  // 他部門の「受付済」は作業待ちだが、リハビリでは期間中ずっとこの状態で実施が
  // 積み上がる。一覧で状態を見たときに待ち行列と誤解されないよう「実施中」と出す。
  { code: "accepted", display: "実施中" },
  { code: "completed", display: "終了" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<RehabTaskStatus>({
  taskCode: REHAB_TASK_CODE,
  statusOptions: REHAB_TASK_STATUS_OPTIONS,
});

export const rehabTaskStatusDisplay = helpers.statusDisplay;

/** 一覧の行から押せる操作。他部門の *TaskAction と同じ形。 */
export interface RehabTaskAction {
  label: string;
  next: RehabTaskStatus;
  /** 日常の流れではない操作(押し間違いの訂正・リハビリの取りやめ)。ケバブメニューに畳む。 */
  secondary?: true;
}

/**
 * 今のステータスから移れる先。
 *
 * 「終了」は実施入力ではなく期間の打ち切り。実施(Procedure の追加)では Task を
 * 動かさないので、他部門のように実施操作が completed へ進める形にはならない。
 *
 * 終了は ServiceRequest 側に終了日も書く(rehabOrderHelpers の
 * buildRehabOrderCloseEntry)。Task だけを completed にすると、status=active のまま
 * 部門一覧の `occurrence=le{基準日}` に永久にヒットし続けるため。
 * 「終了を取消」は Task だけを戻し、書き込んだ終了日は消さない(非対称。画面で注記する)。
 */
export function rehabTaskActions(status: RehabTaskStatus): RehabTaskAction[] {
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
      return [{ label: "終了を取消", next: "accepted", secondary: true }];
    case "cancelled":
      return [{ label: "中止を取消", next: "requested", secondary: true }];
  }
}

/** Task がリハビリの進捗かどうか。他部門との振り分けに使う。 */
export const isRehabTask = helpers.isTask;

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export const rehabTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const rehabTasksByOrderId = helpers.tasksByOrderId;

/**
 * ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照)。
 * executionPeriod は受付で start、終了で end。accepted の間は end を入れない。
 */
export const buildRehabTaskUpdate = helpers.buildTaskUpdate;
