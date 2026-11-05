import { createTaskHelpers } from "./taskHelpers";

// 細菌検査の進捗。検体検査・病理検査と同じ考え方で、オーダーの ServiceRequest は
// そのままにして、進捗を Task で別に持つ。
//
//   ServiceRequest(オーダー) ← focus ── Task(進捗)
//
// Task は最初のステータス変更(受付・中止)か、結果の保存で作る。オーダー登録時には
// 作らないので、一覧では「Task が無い = 依頼済(未受付)」として扱う。
//
// 培養に日数がかかるため、部門の手が離れるのは最終報告のとき。報告済へは一覧の
// ボタンではなく結果の保存で進める(microTaskStatusForReport)。中間報告の段階は
// Task には持たず、結果の報告区分(DiagnosticReport.status)で見せる。

export const MICRO_TASK_CODE = { code: "micro-exam", display: "細菌検査" };

/**
 * 細菌検査の進捗。
 *
 * requested … 依頼済(検査室はまだ検体を受け取っていない)
 * accepted  … 受付済(検体が検査室に届いた。中間報告の間もここ)
 * completed … 報告済(最終報告まで終わった)
 * cancelled … 中止
 */
export type MicroTaskStatus = "requested" | "accepted" | "completed" | "cancelled";

export const MICRO_TASK_STATUS_OPTIONS: { code: MicroTaskStatus; display: string }[] = [
  { code: "requested", display: "依頼済" },
  { code: "accepted", display: "受付済" },
  { code: "completed", display: "報告済" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<MicroTaskStatus>({
  taskCode: MICRO_TASK_CODE,
  statusOptions: MICRO_TASK_STATUS_OPTIONS,
});

export const microTaskStatusDisplay = helpers.statusDisplay;

/** 一覧の行から押せる操作。病理検査の PathoTaskAction と同じ形。 */
export interface MicroTaskAction {
  label: string;
  next: MicroTaskStatus;
  /** 日常の流れではない操作(押し間違いの訂正・検査の取りやめ)。ケバブメニューに畳む。 */
  secondary?: true;
}

/**
 * 今のステータスから移れる先。
 *
 * 「取消」は 1 つ前に戻す訂正、「中止」は検査そのものの取りやめ(検体検査・病理と同じ区別)。
 * 報告済は結果の報告区分に従うので、ここからは動かさない(最終報告を中間報告に直すか
 * 結果を消すと受付済に戻る)。
 */
export function microTaskActions(status: MicroTaskStatus): MicroTaskAction[] {
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
    case "completed":
      return [];
    case "cancelled":
      return [{ label: "中止取消", next: "requested", secondary: true }];
  }
}

/** 結果を書けるか。検体が検査室に届いてから(報告済の結果は直せる)。 */
export function canEnterMicroResult(status: MicroTaskStatus): boolean {
  return status === "accepted" || status === "completed";
}

/**
 * 結果の保存・削除に合わせた進捗。変えなくてよいときは undefined。
 *
 * reportStatus は保存した結果の報告区分で、結果を消したときは null。最終報告で報告済、
 * 中間報告なら受付済(結果があるなら検体は届いている)、結果が無くなれば報告済から受付済へ戻す。
 * 中止したオーダーは動かさない(中止を結果の保存で黙って解かない)。
 */
export function microTaskStatusForReport(
  current: MicroTaskStatus,
  reportStatus: string | null,
): MicroTaskStatus | undefined {
  if (current === "cancelled") return undefined;
  const next: MicroTaskStatus =
    reportStatus === null
      ? current === "completed"
        ? "accepted"
        : current
      : reportStatus === "preliminary"
        ? "accepted"
        : "completed";
  return next === current ? undefined : next;
}

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export const microTaskStatus = helpers.taskStatus;

/**
 * 画面に出す進捗。Task が無いまま結果が付いたオーダー(進捗を Task で持つ前に結果を
 * 登録したもの)は、結果の報告区分から読む(結果があるなら検体は届いている)。
 * reportStatus は紐付く結果の報告区分で、結果が無ければ空。
 */
export function microOrderStatus(task: fhir4.Task | undefined, reportStatus: string): MicroTaskStatus {
  if (task || !reportStatus) return microTaskStatus(task);
  return reportStatus === "preliminary" ? "accepted" : "completed";
}

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export const microTasksByOrderId = helpers.tasksByOrderId;

/**
 * ステータスを変えた Task。まだ無ければ作る(組み立ては taskHelpers を参照。
 * executionPeriod は受付で start、報告済で end)。
 */
export const buildMicroTaskUpdate = helpers.buildTaskUpdate;
