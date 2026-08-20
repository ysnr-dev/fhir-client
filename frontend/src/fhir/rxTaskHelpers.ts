import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";

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

/** Task.code。部門の作業種別(検体検査の lab-exam と同じ CodeSystem)。 */
const TASK_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/task-code";
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

export function rxTaskStatusDisplay(status: RxTaskStatus): string {
  return RX_TASK_STATUS_OPTIONS.find((o) => o.code === status)?.display ?? status;
}

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
export function isRxTask(task: fhir4.Task): boolean {
  return Boolean(
    task.code?.coding?.some((c) => c.system === TASK_CODE_SYSTEM && c.code === RX_TASK_CODE.code),
  );
}

/** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
export function rxTaskStatus(task: fhir4.Task | undefined): RxTaskStatus {
  const status = task?.status;
  return isRxTaskStatus(status) ? status : "requested";
}

function isRxTaskStatus(status: string | undefined): status is RxTaskStatus {
  return RX_TASK_STATUS_OPTIONS.some((o) => o.code === status);
}

/** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
export function rxTasksByOrderId(tasks: fhir4.Task[]): Map<string, fhir4.Task> {
  const byOrderId = new Map<string, fhir4.Task>();
  for (const task of tasks) {
    if (!isRxTask(task)) continue;
    const orderId = task.focus?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
    if (orderId) byOrderId.set(orderId, task);
  }
  return byOrderId;
}

/**
 * ステータスを変えた Task。まだ無ければ作る(組み立ての理由は radTaskHelpers の
 * buildRadTaskUpdate を参照。executionPeriod は受付で start、調剤で end)。
 */
export function buildRxTaskUpdate(
  task: fhir4.Task | undefined,
  order: fhir4.ServiceRequest,
  status: RxTaskStatus,
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
      coding: [{ system: TASK_CODE_SYSTEM, ...RX_TASK_CODE }],
      text: RX_TASK_CODE.display,
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
  status: RxTaskStatus,
  now: string,
): fhir4.Period | undefined {
  // 依頼済に戻す/中止するのは「部門が作業した時間帯」が無いのと同じ。
  if (status === "requested" || status === "cancelled") return undefined;

  const start = task?.executionPeriod?.start ?? now;
  if (status === "accepted") return { start };
  // 調剤済で部門(薬剤部)の作業は終わる。実施済への遷移では end を動かさない。
  return { start, end: task?.executionPeriod?.end ?? now };
}
