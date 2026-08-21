import { createTaskHelpers } from "./taskHelpers";

// 検体検査の進捗(受付・到着)。放射線検査(radTaskHelpers)と同じ考え方で、
// オーダーの ServiceRequest はそのままにして、進捗を Task で別に持つ。
//
//   ServiceRequest(オーダー) ← focus ── Task(進捗)
//
// Task は最初のステータス変更(受付・中止)で作る。オーダー登録時には作らないので、
// 一覧では「Task が無い = 依頼済(未受付)」として扱う。検体検査一覧を作る前に
// 登録されたオーダーもそのまま並べられるようにするため。
//
// 受付済へは検体ラベルの発行で進む(docs/lab-label-design.md。採血室が最初にする
// のがラベルの発行なので、それを受付そのものとして扱う)。実施済へは到着確認画面の
// スキャンで進む(docs/lab-arrival-design.md。管ごとの到着は上流の Specimen に記録し、
// オーダーの全検体が揃った時点で部門の作業は終わりなので Task を実施済にする)。

export const LAB_TASK_CODE = { code: "lab-exam", display: "検体検査" };

/**
 * 検体検査の進捗。
 *
 * requested … 依頼済(部門はまだ受け取っていない)
 * accepted  … 受付済(患者が採血室に来て、検体ラベルを発行した)
 * completed … 実施済(オーダーの検体が全部そろって検査室に着いた)
 * cancelled … 中止
 */
export type LabTaskStatus = "requested" | "accepted" | "completed" | "cancelled";

export const LAB_TASK_STATUS_OPTIONS: { code: LabTaskStatus; display: string }[] = [
  { code: "requested", display: "依頼済" },
  { code: "accepted", display: "受付済" },
  { code: "completed", display: "実施済" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<LabTaskStatus>({
  taskCode: LAB_TASK_CODE,
  statusOptions: LAB_TASK_STATUS_OPTIONS,
});

export const labTaskStatusDisplay = helpers.statusDisplay;

/** 一覧の行から押せる操作。放射線検査の RadTaskAction と同じ形。 */
export interface LabTaskAction {
  label: string;
  next: LabTaskStatus;
  /** 日常の流れではない操作(押し間違いの訂正・検査の取りやめ)。ケバブメニューに畳む。 */
  secondary?: true;
}

/**
 * 今のステータスから移れる先。
 *
 * 「取消」は 1 つ前に戻す訂正、「中止」は検査そのものの取りやめ(放射線と同じ区別)。
 * 受付済・実施済への通常の遷移はここではなく、一覧のラベル発行と到着確認画面の
 * スキャンが行う。
 */
export function labTaskActions(status: LabTaskStatus): LabTaskAction[] {
  switch (status) {
    case "requested":
      return [
        // 受付はラベル発行が兼ねる。これはラベルの帳票レイアウトが未登録で発行を
        // 押せない環境のための手動フォールバック(実施済にする、と同じ扱い)。
        { label: "受付済にする", next: "accepted", secondary: true },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "accepted":
      return [
        // 到着確認はスキャン(到着確認画面)が原則。これはスキャナが使えない場面の
        // 手動フォールバックで、管ごとの到着記録は付かず Task だけ進む。
        { label: "実施済にする", next: "completed", secondary: true },
        { label: "取消", next: "requested", secondary: true },
        { label: "中止", next: "cancelled", secondary: true },
      ];
    case "completed":
      return [{ label: "取消", next: "accepted", secondary: true }];
    case "cancelled":
      return [{ label: "中止を取消", next: "requested", secondary: true }];
  }
}

/** Task が検体検査の進捗かどうか。放射線検査など他部門との振り分けに使う。 */
export const isLabTask = helpers.isTask;

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export const labTaskStatus = helpers.taskStatus;

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const labTasksByOrderId = helpers.tasksByOrderId;

/**
 * ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照。
 * executionPeriod は受付で start、到着で end)。
 */
export const buildLabTaskUpdate = helpers.buildTaskUpdate;
