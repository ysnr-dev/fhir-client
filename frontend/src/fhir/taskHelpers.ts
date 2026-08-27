import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";

// 部門進捗 Task(放射線検査・検体検査・調剤)の共通実装。
//
//   ServiceRequest(オーダー) ← focus ── Task(進捗)
//
// オーダーはそのままにして進捗を Task で別に持つ理由や executionPeriod の扱いは
// radTaskHelpers のコメントを参照。ここには「どの部門でも同じ形」の判定・突き合わせ・
// 組み立てだけを置き、状態遷移表(actions)や進捗の意味付けは各 *TaskHelpers に残す。

/** Task.code。部門の作業種別。部門をまたいだ Task の振り分けに使う。 */
export const TASK_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/task-code";

export interface TaskHelpersConfig<S extends fhir4.Task["status"]> {
  /** 作業種別(rad-exam / lab-exam / rx-dispense)。 */
  taskCode: { code: string; display: string };
  statusOptions: { code: S; display: string }[];
  /**
   * completed へ進めるとき executionPeriod.end を動かさない(調剤済で部門の作業が
   * 終わる処方用。既に end があればそれを保つ)。
   */
  preserveEnd?: boolean;
}

export function createTaskHelpers<S extends fhir4.Task["status"]>(config: TaskHelpersConfig<S>) {
  const { taskCode, statusOptions, preserveEnd } = config;

  /** Task がこの部門の進捗かどうか。 */
  function isTask(task: fhir4.Task): boolean {
    return Boolean(
      task.code?.coding?.some((c) => c.system === TASK_CODE_SYSTEM && c.code === taskCode.code),
    );
  }

  function isStatus(status: string | undefined): status is S {
    return statusOptions.some((o) => o.code === status);
  }

  /** 進捗。Task がまだ無いオーダー(部門が触っていない)は依頼済。 */
  function taskStatus(task: fhir4.Task | undefined): S {
    const status = task?.status;
    return isStatus(status) ? status : ("requested" as S);
  }

  function statusDisplay(status: S): string {
    return statusOptions.find((o) => o.code === status)?.display ?? status;
  }

  /** ServiceRequest の id → その進捗。焦点(focus)で突き合わせる。 */
  function tasksByOrderId(tasks: fhir4.Task[]): Map<string, fhir4.Task> {
    const byOrderId = new Map<string, fhir4.Task>();
    for (const task of tasks) {
      if (!isTask(task)) continue;
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
  function buildTaskUpdate(
    task: fhir4.Task | undefined,
    order: fhir4.ServiceRequest,
    status: S,
    // オーダーを指す参照。即実施(オーダー登録と同時に実施済にする)では、ヘッダが
    // まだ採番されていないので同じ Bundle 内の fullUrl(urn:uuid)を渡す。
    orderReference: string = `ServiceRequest/${order.id}`,
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
        coding: [{ system: TASK_CODE_SYSTEM, ...taskCode }],
        text: taskCode.display,
      },
      focus: { reference: orderReference },
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
    status: S,
    now: string,
  ): fhir4.Period | undefined {
    // 依頼済に戻す/中止するのは「部門が作業した時間帯」が無いのと同じ。
    if (status === "requested" || status === "cancelled") return undefined;

    const start = task?.executionPeriod?.start ?? now;
    // 受付済・作業中はまだ終わっていないので終了時刻を入れない(手術の「入室中」が
    // これに当たる)。end が入るのは実施済・中止など「部門の手が離れた」状態だけ。
    if (status === "accepted" || status === "in-progress") return { start };
    return { start, end: preserveEnd ? (task?.executionPeriod?.end ?? now) : now };
  }

  return { isTask, taskStatus, statusDisplay, tasksByOrderId, buildTaskUpdate };
}
