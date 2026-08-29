import { createTaskHelpers } from "./taskHelpers";

// 輸血の進捗。オーダーそのものは ServiceRequest のままにして、「その依頼が輸血部門で
// どこまで進んだか」を Task で別に持つ(他部門と同じ形。理由は treatmentTaskHelpers
// を参照)。
//
//   ServiceRequest(オーダー) ← focus ── Task(進捗)
//
// 他部門(依頼済 → 受付済 → 実施済)と違い、手術と同じく出庫(in-progress)を 1 段挟む。
// 輸血は「輸血部門が製剤を払い出した」時点と「病棟が投与し終えた」時点が別の場所・
// 別の担当の作業で、出庫したまま投与されていない製剤を部門が把握できないと事故に
// つながるため(docs/transfusion-order-design.md §2.8)。

export const TRANSFUSION_TASK_CODE = { code: "transfusion", display: "輸血" };

/**
 * 輸血の進捗。
 *
 * requested   … 依頼済(輸血部門はまだ受け取っていない)
 * accepted    … 受付済(依頼を受けた。血液型検査・交差適合試験を行っている)
 * in-progress … 出庫済(製剤を払い出した。病棟が投与するのを待っている)
 * completed   … 実施済(投与が終わった)
 * cancelled   … 中止
 */
export type TransfusionTaskStatus =
  | "requested"
  | "accepted"
  | "in-progress"
  | "completed"
  | "cancelled";

export const TRANSFUSION_TASK_STATUS_OPTIONS: {
  code: TransfusionTaskStatus;
  display: string;
}[] = [
  { code: "requested", display: "依頼済" },
  { code: "accepted", display: "受付済" },
  { code: "in-progress", display: "出庫済" },
  { code: "completed", display: "実施済" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<TransfusionTaskStatus>({
  taskCode: TRANSFUSION_TASK_CODE,
  statusOptions: TRANSFUSION_TASK_STATUS_OPTIONS,
});

export const transfusionTaskStatusDisplay = helpers.statusDisplay;

/** 一覧の行から押せる操作。手術の SurgeryTaskAction と同じ形。 */
export interface TransfusionTaskAction {
  label: string;
  next: TransfusionTaskStatus;
  /** 日常の流れではない操作(押し間違いの訂正・輸血の取りやめ)。ケバブメニューに畳む。 */
  secondary?: true;
}

/**
 * 今のステータスから移れる先。
 *
 * 「受付取消」「出庫取消」は 1 つ前に戻す訂正で、手術と同じく**取り消す対象を名前に
 * 入れる** —— 段が 4 つあるので、ただの「取消」ではどこまで戻るのかがメニューの中で
 * 分からない。「中止」は輸血そのものを取りやめる操作で、これらとは別のもの。
 *
 * 実施(completed)へ進める操作をここに置いていないのは、実施記録(製剤番号・開始/終了
 * 時刻・副作用)を入れて初めて実施済にするため。実施入力は第 4 段階で、しかも輸血は
 * 投与するのが病棟なので、部門一覧だけでなくカルテからも開く必要がある
 * (docs/transfusion-order-design.md §5)。それまでの間は出庫済で止まる。
 */
export function transfusionTaskActions(
  status: TransfusionTaskStatus,
): TransfusionTaskAction[] {
  switch (status) {
    case "requested":
      return [
        { label: "受付", next: "accepted" },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "accepted":
      return [
        { label: "出庫", next: "in-progress" },
        { label: "受付取消", next: "requested", secondary: true },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "in-progress":
      return [
        { label: "出庫取消", next: "accepted", secondary: true },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "completed":
      return [{ label: "実施取消", next: "in-progress", secondary: true }];
    case "cancelled":
      return [{ label: "中止を取消", next: "requested", secondary: true }];
  }
}

/** Task が輸血の進捗かどうか。他部門との振り分けに使う。 */
export const isTransfusionTask = helpers.isTask;

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export const transfusionTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const transfusionTasksByOrderId = helpers.tasksByOrderId;

/**
 * ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照。
 * executionPeriod は受付で start、実施済で end。出庫済は終了時刻を入れない)。
 */
export const buildTransfusionTaskUpdate = helpers.buildTaskUpdate;
