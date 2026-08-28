import { createTaskHelpers } from "./taskHelpers";

// 手術の進捗。オーダーそのものは ServiceRequest のままにして、「その申込が手術部で
// どこまで進んだか」を Task で別に持つ(他部門と同じ形。理由は treatmentTaskHelpers
// を参照)。
//
//   ServiceRequest(申込) ← focus ── Task(進捗)
//
// 他部門(依頼済 → 受付済 → 実施済)と違い、手術は受付(日程確定)から実施までが長く、
// その間「今この患者が手術中である」ことが分からないと病棟・麻酔科・家族への説明が
// 回らない。そこで入室(in-progress)を 1 段挟む。入室は Task を進めるだけで、
// 実施記録は退室後にまとめて 1 回入れる(docs/surgery-result-design.md)。

export const SURGERY_TASK_CODE = { code: "surgery", display: "手術" };

/**
 * 手術の進捗。
 *
 * requested   … 申込済(手術部はまだ受け取っていない)
 * accepted    … 受付済(手術部が申込を受け付け、日程を確定した)
 * in-progress … 入室中(患者が手術室に入った。実施記録はまだ)
 * completed   … 実施済(退室し、実施記録を入れた)
 * cancelled   … 中止
 */
export type SurgeryTaskStatus =
  | "requested"
  | "accepted"
  | "in-progress"
  | "completed"
  | "cancelled";

export const SURGERY_TASK_STATUS_OPTIONS: { code: SurgeryTaskStatus; display: string }[] = [
  { code: "requested", display: "申込済" },
  { code: "accepted", display: "受付済" },
  { code: "in-progress", display: "入室中" },
  { code: "completed", display: "実施済" },
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
   * 押すと実施入力を開く操作。ステータスだけを進める他の操作と違い、実施記録
   * (時刻・実施術式・スタッフ・出血量・薬剤・材料)を入れてから Task の完了と
   * 一緒に登録する。
   */
  opensPerformInput?: true;
  /**
   * 日常の流れではない操作(押し間違いの訂正・手術の取りやめ)。一覧では
   * ケバブメニューに畳み、その行で普通に押す操作だけをボタンで出す。
   */
  secondary?: true;
}

/**
 * 今のステータスから移れる先。
 *
 * 「受付取消」「入室取消」「実施取消」は 1 つ前に戻す操作(押し間違いの訂正)で、
 * **取り消す対象を名前に入れる** —— 手術は受付から実施まで段が多く、ただの「取消」だと
 * どこまで戻るのかがメニューの中で分からない。「中止」は手術そのものを取りやめる操作で、
 * これらとは別のもの。中止からは申込済に戻せる。
 *
 * 「実施取消」は実施記録ごと消して入室中に戻す(他部門と違い記録を残さない。
 * 理由は docs/surgery-result-design.md)。
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
        { label: "入室", next: "in-progress" },
        { label: "受付取消", next: "requested", secondary: true },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "in-progress":
      return [
        { label: "実施", next: "completed", opensPerformInput: true },
        { label: "入室取消", next: "accepted", secondary: true },
      ];
    case "completed":
      return [{ label: "実施取消", next: "in-progress", secondary: true }];
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
