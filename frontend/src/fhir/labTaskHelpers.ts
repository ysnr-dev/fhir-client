import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";

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

/** Task.code。部門の作業種別(放射線検査の rad-exam と同じ CodeSystem)。 */
const TASK_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/task-code";
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

export function labTaskStatusDisplay(status: LabTaskStatus): string {
  return LAB_TASK_STATUS_OPTIONS.find((o) => o.code === status)?.display ?? status;
}

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
export function isLabTask(task: fhir4.Task): boolean {
  return Boolean(
    task.code?.coding?.some((c) => c.system === TASK_CODE_SYSTEM && c.code === LAB_TASK_CODE.code),
  );
}

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export function labTaskStatus(task: fhir4.Task | undefined): LabTaskStatus {
  const status = task?.status;
  return isLabTaskStatus(status) ? status : "requested";
}

function isLabTaskStatus(status: string | undefined): status is LabTaskStatus {
  return LAB_TASK_STATUS_OPTIONS.some((o) => o.code === status);
}

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export function labTasksByOrderId(tasks: fhir4.Task[]): Map<string, fhir4.Task> {
  const byOrderId = new Map<string, fhir4.Task>();
  for (const task of tasks) {
    if (!isLabTask(task)) continue;
    const orderId = task.focus?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
    if (orderId) byOrderId.set(orderId, task);
  }
  return byOrderId;
}

/**
 * ステータスを変えた Task。まだ無ければ作る(組み立ての理由は radTaskHelpers の
 * buildRadTaskUpdate を参照。executionPeriod は受付で start、到着で end)。
 */
export function buildLabTaskUpdate(
  task: fhir4.Task | undefined,
  order: fhir4.ServiceRequest,
  status: LabTaskStatus,
): fhir4.Task {
  const now = toFhirDateTime(toDateTimeInput(new Date()));
  const patientReference = order.subject?.reference ?? "";

  const next: fhir4.Task = {
    ...(task ?? {}),
    resourceType: "Task",
    status,
    // 依頼を受けて実施する作業なので filler-order(受け手が起こしたオーダー)。
    intent: "filler-order",
    code: {
      coding: [{ system: TASK_CODE_SYSTEM, ...LAB_TASK_CODE }],
      text: LAB_TASK_CODE.display,
    },
    focus: { reference: `ServiceRequest/${order.id}` },
    // Task.for が無いと患者コンパートメントに入らない(radTaskHelpers と同じ)。
    ...(patientReference ? { for: { reference: patientReference } } : {}),
    authoredOn: task?.authoredOn ?? now,
    lastModified: now,
  };

  if (order.priority) next.priority = order.priority;
  if (order.requester) next.requester = order.requester;

  const period = executionPeriod(task, status, now);
  if (period) next.executionPeriod = period;
  else delete next.executionPeriod;

  return next;
}

function executionPeriod(
  task: fhir4.Task | undefined,
  status: LabTaskStatus,
  now: string,
): fhir4.Period | undefined {
  // 依頼済に戻す/中止するのは「部門が作業した時間帯」が無いのと同じ。
  if (status === "requested" || status === "cancelled") return undefined;

  const start = task?.executionPeriod?.start ?? now;
  if (status === "accepted") return { start };
  return { start, end: now };
}
