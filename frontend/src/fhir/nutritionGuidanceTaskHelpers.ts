import { createTaskHelpers } from "./taskHelpers";

// 栄養指導の進捗。オーダーそのものは ServiceRequest のままにして、「その依頼が栄養
// 部門でどこまで進んだか」を Task で別に持つ形は他部門と同じ。
//
//   ServiceRequest(オーダー) ← focus ── Task(進捗)
//
// ただし **Task の意味はリハビリと同じで他部門と違う**
// (docs/nutrition-guidance-order-design.md §3、docs/rehab-order-design.md §4)。
//
// 他部門の Task は「1 回の作業の進捗」で、実施したら completed になる。栄養指導は
// 1 つのオーダーで初回・継続と指導が何度も積み上がるので、同じにすると初回の指導で
// completed になり 2 回目以降が実施できなくなる。
//
// そこで栄養指導の Task は **部門の受け入れ状態** を表す:
//
//   requested … 依頼済(栄養部門がまだ受けていない)
//   accepted  … 受付済(受けた = 実施中。期間中ずっとこの状態)
//   completed … 終了(期間が終わった)
//   cancelled … 中止
//
// 日々の指導は Task を動かさず Procedure を追加するだけ
// (nutritionGuidanceResultHelpers.ts の buildNutritionGuidancePerformBundle)。
// リハビリと同じ逸脱なので、部門一覧の実施ボタンを他部門と同じ形に「揃える」
// リファクタをしてはいけない。

export const NUTRITION_GUIDANCE_TASK_CODE = {
  code: "nutrition-guidance",
  display: "栄養指導",
};

/** 栄養指導の進捗(= 栄養部門の受け入れ状態)。 */
export type NutritionGuidanceTaskStatus =
  | "requested"
  | "accepted"
  | "completed"
  | "cancelled";

export const NUTRITION_GUIDANCE_TASK_STATUS_OPTIONS: {
  code: NutritionGuidanceTaskStatus;
  display: string;
}[] = [
  { code: "requested", display: "依頼済" },
  // 他部門の「受付済」は作業待ちだが、栄養指導では期間中ずっとこの状態で指導が
  // 積み上がる。一覧で状態を見たときに待ち行列と誤解されないよう「実施中」と出す。
  { code: "accepted", display: "実施中" },
  { code: "completed", display: "終了" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<NutritionGuidanceTaskStatus>({
  taskCode: NUTRITION_GUIDANCE_TASK_CODE,
  statusOptions: NUTRITION_GUIDANCE_TASK_STATUS_OPTIONS,
});

export const nutritionGuidanceTaskStatusDisplay = helpers.statusDisplay;

/** 一覧の行から押せる操作。他部門の *TaskAction と同じ形。 */
export interface NutritionGuidanceTaskAction {
  label: string;
  next: NutritionGuidanceTaskStatus;
  /** 日常の流れではない操作(押し間違いの訂正・指導の取りやめ)。ケバブメニューに畳む。 */
  secondary?: true;
}

/**
 * 今のステータスから移れる先。
 *
 * 「終了」は実施入力ではなく期間の打ち切り。指導(Procedure の追加)では Task を
 * 動かさないので、他部門のように実施操作が completed へ進める形にはならない。
 *
 * 終了は ServiceRequest 側に終了日も書く(nutritionGuidanceOrderHelpers の
 * buildNutritionGuidanceOrderCloseEntry)。Task だけを completed にすると、
 * status=active のまま部門一覧の `occurrence=le{基準日}` に永久にヒットし続けるため。
 * 「終了を取消」は Task だけを戻し、書き込んだ終了日は消さない(非対称。画面で注記する)。
 */
export function nutritionGuidanceTaskActions(
  status: NutritionGuidanceTaskStatus,
): NutritionGuidanceTaskAction[] {
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

/** Task が栄養指導の進捗かどうか。他部門との振り分けに使う。 */
export const isNutritionGuidanceTask = helpers.isTask;

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export const nutritionGuidanceTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const nutritionGuidanceTasksByOrderId = helpers.tasksByOrderId;

/**
 * ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照)。
 * executionPeriod は受付で start、終了で end。accepted の間は end を入れない。
 */
export const buildNutritionGuidanceTaskUpdate = helpers.buildTaskUpdate;
