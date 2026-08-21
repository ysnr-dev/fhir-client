import { createTaskHelpers } from "./taskHelpers";

// 放射線検査の進捗(受付・実施)。オーダーそのものは ServiceRequest のままにして、
// 「その依頼が部門でどこまで進んだか」を Task で別に持つ。
//
//   ServiceRequest(オーダー) ← focus ── Task(進捗)
//
// オーダーを直に書き換えないのは、依頼した内容(誰が何をいつ撮ると決めたか)と、
// 部門がそれをどう捌いたかは別の事実だから。オーダーの status を進捗に流用すると
// 依頼内容の更新と実施入力が同じリソースの取り合いになる。
//
// Task は最初のステータス変更(受付・実施・中止)で作る。オーダー登録時には作らない
// ので、一覧では「Task が無い = 依頼済(未受付)」として扱う。放射線検査一覧を
// 作る前に登録されたオーダーもそのまま並べられるようにするため。
//
// 進捗は Task.status(FHIR 固定の値セット)だけで表す。施設ごとのコードを載せる
// businessStatus は、今の 4 状態が標準コードにそのまま対応するので使っていない。

export const RAD_TASK_CODE = { code: "rad-exam", display: "放射線検査" };

/**
 * 放射線検査の進捗。
 *
 * requested … 依頼済(部門はまだ受け取っていない)
 * accepted  … 受付済(患者が放射線部に来て、撮影待ち)
 * completed … 実施済
 * cancelled … 中止
 */
export type RadTaskStatus = "requested" | "accepted" | "completed" | "cancelled";

export const RAD_TASK_STATUS_OPTIONS: { code: RadTaskStatus; display: string }[] = [
  { code: "requested", display: "依頼済" },
  { code: "accepted", display: "受付済" },
  { code: "completed", display: "実施済" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<RadTaskStatus>({
  taskCode: RAD_TASK_CODE,
  statusOptions: RAD_TASK_STATUS_OPTIONS,
});

export const radTaskStatusDisplay = helpers.statusDisplay;

/** 一覧の行から押せる操作。進める操作と戻す操作を同じ形で並べる。 */
export interface RadTaskAction {
  label: string;
  next: RadTaskStatus;
  /**
   * 押すと実施入力を開く操作。ステータスだけを進める他の操作と違い、実施記録
   * (使った造影剤・器材・手技)を入れてから Task の完了と一緒に登録する。
   */
  opensPerformInput?: true;
  /**
   * 日常の流れではない操作(押し間違いの訂正・検査の取りやめ)。一覧では
   * ケバブメニューに畳み、その行で普通に押す操作だけをボタンで出す。
   */
  secondary?: true;
}

/**
 * 今のステータスから移れる先。
 *
 * 「取消」は実施・受付を打ち消して 1 つ前に戻す操作(押し間違いの訂正)、
 * 「中止」は検査そのものを取りやめる操作で、別のもの。中止からは依頼済に戻せる。
 */
export function radTaskActions(status: RadTaskStatus): RadTaskAction[] {
  switch (status) {
    case "requested":
      return [
        { label: "受付", next: "accepted" },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "accepted":
      return [
        { label: "実施", next: "completed", opensPerformInput: true },
        { label: "取消", next: "requested", secondary: true },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "completed":
      return [{ label: "取消", next: "accepted", secondary: true }];
    case "cancelled":
      return [{ label: "中止を取消", next: "requested", secondary: true }];
  }
}

/** Task が放射線検査の進捗かどうか。他部門の Task が増えたときの振り分けに使う。 */
export const isRadTask = helpers.isTask;

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export const radTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const radTasksByOrderId = helpers.tasksByOrderId;

/** ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照)。 */
export const buildRadTaskUpdate = helpers.buildTaskUpdate;
