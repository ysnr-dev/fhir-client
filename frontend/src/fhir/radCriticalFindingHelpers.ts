import {
  buildCancelledNotificationTask,
  buildNotificationTask,
  hasTaskCode,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";

// 読影レポートの重要所見の通知(docs/rad-report-design.md §6.2)。
//
//   DiagnosticReport(読影レポート) ← focus ── Task(通知) ── owner → 依頼医
//
// 読影医が「重要所見あり」として要点を書くと、依頼医あてにアラートの通知を出す。
// 気胸・大動脈解離のような所見は確定前でも伝える必要があるので、暫定報告でも出す
// (検体検査の緊急異常値が中間報告でも出るのと同じ)。確認は通知を完了にして note に
// 誰がいつを残すだけで、来歴(Provenance)は作らない。

export const RAD_CRITICAL_FINDING_TASK_CODE = { code: "rad-critical-finding", display: "重要所見" };

export const RAD_CRITICAL_FINDING_NOTE = "重要所見を確認しました。";

// 一覧に出す内容は Task.input に持つ(上流の `_include=Task:focus` は ServiceRequest しか返さない)。
const DATE_INPUT = "撮影日";
const EXAM_INPUT = "撮影内容";
const POINT_INPUT = "要点";

export function isRadCriticalFindingTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, RAD_CRITICAL_FINDING_TASK_CODE.code);
}

export interface RadCriticalFindingTaskInput {
  /** 焦点。同じ transaction で作るレポートは urn:uuid、更新は DiagnosticReport/{id}。 */
  reportReference: string;
  patientId: string;
  /** 宛先(依頼医)。 */
  owner?: fhir4.Reference;
  /** 撮影日(YYYY-MM-DD)。 */
  date: string;
  exam: string;
  /** 重要所見の要点。空なら通知を出さない。 */
  point: string;
  basedOn?: fhir4.Reference[];
}

export function buildRadCriticalFindingTask(
  input: RadCriticalFindingTaskInput,
  existing?: fhir4.Task,
): fhir4.Task {
  return buildNotificationTask(
    {
      code: RAD_CRITICAL_FINDING_TASK_CODE,
      // 伝達が遅れると患者に害が出る所見なので、緊急異常値と同じくアラートにする。
      severity: "alert",
      focusReference: input.reportReference,
      patientId: input.patientId,
      owner: input.owner,
      basedOn: input.basedOn,
      description: [input.date, input.exam, input.point].filter(Boolean).join(" "),
      input: [
        { type: { text: DATE_INPUT }, valueDate: input.date },
        { type: { text: EXAM_INPUT }, valueString: input.exam },
        { type: { text: POINT_INPUT }, valueString: input.point },
      ],
    },
    existing,
  );
}

/**
 * レポート保存の transaction に足す通知の entry。
 *
 *   要点あり・通知なし                → 作る
 *   要点あり・要点が同じ(取り下げ以外) → そのまま
 *   要点あり・要点が変わった           → 書き換えて未確認に戻す
 *   要点なし・未確認の通知あり         → 取り下げる
 *   要点なし・確認済みの通知あり       → そのまま(確認した事実は残す)
 */
export function radCriticalFindingEntries(
  input: RadCriticalFindingTaskInput,
  existing: fhir4.Task | undefined,
): fhir4.BundleEntry[] {
  const point = input.point.trim();
  if (!point) {
    if (existing?.status === "requested") {
      return [notificationTaskEntry(buildCancelledNotificationTask(existing), existing.id)];
    }
    return [];
  }
  if (
    existing &&
    existing.status !== "cancelled" &&
    taskInputOf(existing, POINT_INPUT)?.valueString === point
  ) {
    return [];
  }
  return [
    notificationTaskEntry(buildRadCriticalFindingTask({ ...input, point }, existing), existing?.id),
  ];
}

export interface RadCriticalFindingRow extends NotificationRowBase {
  reportId: string;
  date: string;
  exam: string;
  point: string;
}

export function radCriticalFindingRowOf(
  task: fhir4.Task,
  patient: fhir4.Patient | undefined,
): RadCriticalFindingRow {
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    reportId: task.focus?.reference?.match(/^DiagnosticReport\/(.+)$/)?.[1] ?? "",
    date: taskInputOf(task, DATE_INPUT)?.valueDate ?? "",
    exam: taskInputOf(task, EXAM_INPUT)?.valueString ?? "",
    point: taskInputOf(task, POINT_INPUT)?.valueString ?? task.description ?? "",
  };
}
