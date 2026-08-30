import { createTaskHelpers } from "./taskHelpers";

// 注射の進捗。他部門と同じく「ServiceRequest(オーダー) ← focus ── Task(進捗)」で、
// オーダーそのものは動かさずに進捗を Task に持つ(docs/injection-order-design.md §7)。
//
// 注射は 1 施行(= 1 日)1 オーダーなので、Task もその日 1 件に付く。連日オーダーの
// 中止は「この日のみ / この日以降すべて」を選べる(1 日ずつ止まる指示ではなく、
// 「明日からやめる」が実際の指示の形なので)。
//
// Task はオーダー登録時には作らない。最初のステータス変更(いまはカルテからの中止)で
// 作り、それまでは「Task が無い = 依頼済」として扱う。この機能より前に登録された
// 注射もそのまま並べられる。

export const INJECTION_TASK_CODE = { code: "injection", display: "注射" };

/**
 * 注射の進捗。
 *
 * requested   … 依頼済(薬剤部はまだ受け取っていない)
 * accepted    … 受付済(薬剤部が受け取った)
 * in-progress … 払出済(混注・払出が済んだ)
 * completed   … 実施済(施用した)
 * cancelled   … 中止
 *
 * 払出済を completed ではなく in-progress にするのは、実施済(施用)を後から足すため。
 * FHIR Task の状態機械(requested→accepted→in-progress→completed)にもこの順で乗る。
 * 受付済・払出済・実施済へ進める導線(注射ワークリスト・払出・実施入力)はまだ無く、
 * 状態だけ先に定義してある。カルテから押せるのは中止とその取り消しだけ。
 */
export type InjectionTaskStatus =
  | "requested"
  | "accepted"
  | "in-progress"
  | "completed"
  | "cancelled";

export const INJECTION_TASK_STATUS_OPTIONS: { code: InjectionTaskStatus; display: string }[] = [
  { code: "requested", display: "依頼済" },
  { code: "accepted", display: "受付済" },
  { code: "in-progress", display: "払出済" },
  { code: "completed", display: "実施済" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<InjectionTaskStatus>({
  taskCode: INJECTION_TASK_CODE,
  statusOptions: INJECTION_TASK_STATUS_OPTIONS,
  // 払出済(in-progress)で薬剤部の作業は終わる。実施済への遷移では
  // executionPeriod.end を動かさない(処方の調剤と同じ扱い)。
  preserveEnd: true,
});

export const injectionTaskStatusDisplay = helpers.statusDisplay;

/** Task が注射の進捗かどうか。他部門との振り分けに使う。 */
export const isInjectionTask = helpers.isTask;

/** 進捗。Task がまだ無いオーダー(誰も触っていない)は依頼済。 */
export const injectionTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const injectionTasksByOrderId = helpers.tasksByOrderId;

/**
 * ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照)。
 * executionPeriod は受付で start、払出で end。
 */
export const buildInjectionTaskUpdate = helpers.buildTaskUpdate;

/**
 * カルテのカードから中止できるか。
 *
 * 施用してしまった注射(実施済)は中止できない — 中止は「これから行わない」という
 * 指示で、済んだ事実は消せないため(訂正は実施記録側の取り消しで行う。別タスク)。
 */
export function canCancelInjection(status: InjectionTaskStatus): boolean {
  return status !== "cancelled" && status !== "completed";
}

/** 中止を取り消して依頼済に戻せるか。 */
export function canRestoreInjection(status: InjectionTaskStatus): boolean {
  return status === "cancelled";
}
