import { createTaskHelpers } from "./taskHelpers";

// 手術の進捗(受付=日程確定・中止)。オーダーそのものは ServiceRequest のままにして、
// 「その申込が手術部でどこまで進んだか」を Task で別に持つ(他部門と同じ形。理由は
// treatmentTaskHelpers を参照)。
//
//   ServiceRequest(申込) ← focus ── Task(進捗)
//
// 第 1 段階(申込〜日程確保)の状態は 3 つだけ。入室(in-progress)・実施済(completed)は
// 実施記録を作る第 2 段階で足す。

export const SURGERY_TASK_CODE = { code: "surgery", display: "手術" };

/**
 * 手術の進捗。
 *
 * requested … 申込済(手術部はまだ受け取っていない)
 * accepted  … 受付済(手術部が申込を受け付け、日程を確定した)
 * cancelled … 中止
 */
export type SurgeryTaskStatus = "requested" | "accepted" | "cancelled";

export const SURGERY_TASK_STATUS_OPTIONS: { code: SurgeryTaskStatus; display: string }[] = [
  { code: "requested", display: "申込済" },
  { code: "accepted", display: "受付済" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<SurgeryTaskStatus>({
  taskCode: SURGERY_TASK_CODE,
  statusOptions: SURGERY_TASK_STATUS_OPTIONS,
});

export const surgeryTaskStatusDisplay = helpers.statusDisplay;

/** 一覧の行から押せる操作。 */
export interface SurgeryTaskAction {
  label: string;
  next: SurgeryTaskStatus;
  /**
   * 日常の流れではない操作(押し間違いの訂正・手術の取りやめ)。一覧では
   * ケバブメニューに畳み、その行で普通に押す操作だけをボタンで出す。
   */
  secondary?: true;
}

/**
 * 今のステータスから移れる先。
 *
 * 「取消」は受付を打ち消して申込済に戻す操作(押し間違いの訂正)、「中止」は手術
 * そのものを取りやめる操作で、別のもの。中止からは申込済に戻せる。
 */
export function surgeryTaskActions(status: SurgeryTaskStatus): SurgeryTaskAction[] {
  switch (status) {
    case "requested":
      return [
        { label: "受付", next: "accepted" },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "accepted":
      return [
        { label: "取消", next: "requested", secondary: true },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "cancelled":
      return [{ label: "中止を取消", next: "requested", secondary: true }];
  }
}

/** Task が手術の進捗かどうか。他部門の Task が増えたときの振り分けに使う。 */
export const isSurgeryTask = helpers.isTask;

/** 進捗。Task がまだ無いオーダー(手術部が触っていない)は申込済。 */
export const surgeryTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const surgeryTasksByOrderId = helpers.tasksByOrderId;

/** ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照)。 */
export const buildSurgeryTaskUpdate = helpers.buildTaskUpdate;
