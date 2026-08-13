import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";

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

/** Task.code。部門の作業種別。放射線検査以外の Task が増えたときの振り分けに使う。 */
const TASK_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/task-code";
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

export function radTaskStatusDisplay(status: RadTaskStatus): string {
  return RAD_TASK_STATUS_OPTIONS.find((o) => o.code === status)?.display ?? status;
}

/** 一覧の行から押せる操作。進める操作と戻す操作を同じ形で並べる。 */
export interface RadTaskAction {
  label: string;
  next: RadTaskStatus;
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
        { label: "中止", next: "cancelled" },
      ];
    case "accepted":
      return [
        { label: "実施", next: "completed" },
        { label: "取消", next: "requested" },
        { label: "中止", next: "cancelled" },
      ];
    case "completed":
      return [{ label: "取消", next: "accepted" }];
    case "cancelled":
      return [{ label: "中止を取消", next: "requested" }];
  }
}

/** Task が放射線検査の進捗かどうか。他部門の Task が増えたときの振り分けに使う。 */
export function isRadTask(task: fhir4.Task): boolean {
  return Boolean(
    task.code?.coding?.some((c) => c.system === TASK_CODE_SYSTEM && c.code === RAD_TASK_CODE.code),
  );
}

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export function radTaskStatus(task: fhir4.Task | undefined): RadTaskStatus {
  const status = task?.status;
  return isRadTaskStatus(status) ? status : "requested";
}

function isRadTaskStatus(status: string | undefined): status is RadTaskStatus {
  return RAD_TASK_STATUS_OPTIONS.some((o) => o.code === status);
}

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export function radTasksByOrderId(tasks: fhir4.Task[]): Map<string, fhir4.Task> {
  const byOrderId = new Map<string, fhir4.Task>();
  for (const task of tasks) {
    if (!isRadTask(task)) continue;
    const orderId = task.focus?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
    if (orderId) byOrderId.set(orderId, task);
  }
  return byOrderId;
}

/**
 * ステータスを変えた Task。まだ無ければ作る。
 *
 * executionPeriod は部門が作業した時間帯として、受付で start、実施で end を入れる。
 * 取消で前の状態に戻したときは、その時刻も落とす(残すと実施していないのに実施時刻が
 * ある Task になる)。
 */
export function buildRadTaskUpdate(
  task: fhir4.Task | undefined,
  order: fhir4.ServiceRequest,
  status: RadTaskStatus,
): fhir4.Task {
  // toFhirDateTime は「その場の時刻 + 実行環境のオフセット」を組み立てるので、
  // UTC 文字列ではなくローカル時刻の入力形式を渡す。
  const now = toFhirDateTime(toDateTimeInput(new Date()));
  const patientReference = order.subject?.reference ?? "";

  const next: fhir4.Task = {
    ...(task ?? {}),
    resourceType: "Task",
    status,
    // 依頼を受けて実施する作業なので filler-order(受け手が起こしたオーダー)。
    intent: "filler-order",
    code: {
      coding: [{ system: TASK_CODE_SYSTEM, ...RAD_TASK_CODE }],
      text: RAD_TASK_CODE.display,
    },
    focus: { reference: `ServiceRequest/${order.id}` },
    // Task.for が無いと患者コンパートメントに入らず、患者単位の読み出しから
    // 見えなくなる(上流の TaskValidator も警告する)。
    ...(patientReference ? { for: { reference: patientReference } } : {}),
    authoredOn: task?.authoredOn ?? now,
    lastModified: now,
  };

  if (order.priority) next.priority = order.priority;
  // 依頼元(誰の依頼で動いているか)はオーダーから引き継ぐ。
  if (order.requester) next.requester = order.requester;

  const period = executionPeriod(task, status, now);
  if (period) next.executionPeriod = period;
  else delete next.executionPeriod;

  return next;
}

function executionPeriod(
  task: fhir4.Task | undefined,
  status: RadTaskStatus,
  now: string,
): fhir4.Period | undefined {
  // 依頼済に戻す/中止するのは「部門が作業した時間帯」が無いのと同じ。
  if (status === "requested" || status === "cancelled") return undefined;

  const start = task?.executionPeriod?.start ?? now;
  if (status === "accepted") return { start };
  return { start, end: now };
}
