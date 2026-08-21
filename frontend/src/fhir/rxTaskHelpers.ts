import { createTaskHelpers } from "./taskHelpers";

// 処方(調剤)の進捗。検体検査(labTaskHelpers)・放射線検査(radTaskHelpers)と同じ
// 考え方で、オーダーの ServiceRequest はそのままにして、進捗を Task で別に持つ。
//
//   ServiceRequest(処方オーダー) ← focus ── Task(進捗)
//
// Task は最初のステータス変更(処方箋発行・中止)で作る。オーダー登録時には作らない
// ので、一覧では「Task が無い = 依頼済(未受付)」として扱う。処方一覧を作る前に
// 登録されたオーダーもそのまま並べられるようにするため。
//
// 受付済へは処方一覧の「処方箋発行」で進む(発行が受付を兼ねる。処方箋そのものの
// 印刷は別タスク)。調剤済へは「調剤登録」(RxDispenseModal)で進み、調剤結果の
// MedicationDispense と一緒に 1 つの transaction で書き込む。

export const RX_TASK_CODE = { code: "rx-dispense", display: "調剤" };

/**
 * 処方(調剤)の進捗。
 *
 * requested   … 依頼済(部門はまだ受け取っていない)
 * accepted    … 受付済(処方箋を発行した)
 * in-progress … 調剤済(調剤結果を登録した)
 * completed   … 実施済(与薬・服薬の実施。作成する導線は別タスクで追加予定)
 * cancelled   … 中止
 *
 * 調剤済を completed ではなく in-progress にするのは、実施済を後から足すため。
 * FHIR Task の状態機械(requested→accepted→in-progress→completed)にもこの順で乗る。
 */
export type RxTaskStatus = "requested" | "accepted" | "in-progress" | "completed" | "cancelled";

export const RX_TASK_STATUS_OPTIONS: { code: RxTaskStatus; display: string }[] = [
  { code: "requested", display: "依頼済" },
  { code: "accepted", display: "受付済" },
  { code: "in-progress", display: "調剤済" },
  { code: "completed", display: "実施済" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<RxTaskStatus>({
  taskCode: RX_TASK_CODE,
  statusOptions: RX_TASK_STATUS_OPTIONS,
  // 調剤済(in-progress)で部門(薬剤部)の作業は終わる。実施済への遷移では
  // executionPeriod.end を動かさない。
  preserveEnd: true,
});

export const rxTaskStatusDisplay = helpers.statusDisplay;

/** 一覧の行から押せる操作。検体検査の LabTaskAction と同じ形。 */
export interface RxTaskAction {
  label: string;
  next: RxTaskStatus;
  /** 日常の流れではない操作(押し間違いの訂正・処方の取りやめ)。ケバブメニューに畳む。 */
  secondary?: true;
}

/**
 * 今のステータスから移れる先。
 *
 * 「取消」は 1 つ前に戻す訂正、「中止」は処方そのものの取りやめ(検体検査と同じ区別)。
 * 受付済・調剤済への通常の遷移はここではなく、一覧の「処方箋発行」と「調剤登録」が行う。
 */
export function rxTaskActions(status: RxTaskStatus): RxTaskAction[] {
  switch (status) {
    case "requested":
      return [{ label: "中止", next: "cancelled", secondary: true }];
    case "accepted":
      return [
        { label: "取消", next: "requested", secondary: true },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "in-progress":
      // 戻しても登録済みの調剤結果(MedicationDispense)は残る。結果登録後の取消と
      // 同じ扱いで、進捗だけを戻す(調剤結果の訂正・削除は別タスク)。
      return [{ label: "取消", next: "accepted", secondary: true }];
    case "completed":
      // 実施済を作る導線はまだ無い(別タスク)。操作もその設計と一緒に決める。
      return [];
    case "cancelled":
      return [{ label: "中止を取消", next: "requested", secondary: true }];
  }
}

/** Task が処方(調剤)の進捗かどうか。検体検査など他部門との振り分けに使う。 */
export const isRxTask = helpers.isTask;

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export const rxTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const rxTasksByOrderId = helpers.tasksByOrderId;

/**
 * ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照。
 * executionPeriod は受付で start、調剤で end)。
 */
export const buildRxTaskUpdate = helpers.buildTaskUpdate;
