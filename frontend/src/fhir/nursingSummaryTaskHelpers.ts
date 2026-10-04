import {
  buildCompletedNotificationTask,
  buildNotificationTask,
  completeNotificationEntry,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";

// 看護サマリの差戻し(通知 Task)。承認者が却下したとき、理由を添えて作成者あてに出す。
// 作成者が直して確定し直したら閉じる(docs/nursing-care-plan-design.md)。

export const NURSING_SUMMARY_RETURNED_TASK_CODE = { code: "nursing-summary-returned", display: "看護サマリ差戻し" };

export const NURSING_SUMMARY_RETURNED_NOTE = "看護サマリを確定し直しました。";

const SUMMARY_LABEL_INPUT = "看護サマリ";
const REASON_INPUT = "理由";

export function buildNursingSummaryReturnedEntry(
  composition: fhir4.Composition,
  patientId: string,
  reason: string,
  summaryLabel: string,
  approver: { practitionerId: string; display: string },
): fhir4.BundleEntry {
  const author = composition.author?.[0];
  const task = buildNotificationTask({
    code: NURSING_SUMMARY_RETURNED_TASK_CODE,
    severity: "info",
    focusReference: `Composition/${composition.id}`,
    patientId,
    owner: author?.reference ? { reference: author.reference, display: author.display } : undefined,
    requester: { reference: `Practitioner/${approver.practitionerId}`, display: approver.display },
    description: `${summaryLabel} 差戻し: ${reason}`,
    input: [
      { type: { text: SUMMARY_LABEL_INPUT }, valueString: summaryLabel },
      { type: { text: REASON_INPUT }, valueString: reason },
    ],
  });
  if (composition.encounter) task.encounter = composition.encounter;
  return notificationTaskEntry(task);
}

/** 確定し直したときに差戻しを閉じる entry。 */
export function buildCompletedReturnedEntries(
  tasks: fhir4.Task[],
  actor: { practitionerId: string; display: string },
): fhir4.BundleEntry[] {
  return tasks
    .filter((task) => task.id && task.status === "requested")
    .map((task) =>
      completeNotificationEntry(buildCompletedNotificationTask(task, actor, NURSING_SUMMARY_RETURNED_NOTE)),
    );
}

export function nursingSummaryReturnReason(task: fhir4.Task): string {
  return taskInputOf(task, REASON_INPUT)?.valueString ?? "";
}

export interface NursingSummaryReturnedRow extends NotificationRowBase {
  compositionId: string;
  summaryLabel: string;
  reason: string;
  requesterName: string;
}

export function nursingSummaryReturnedRowOf(
  task: fhir4.Task,
  patient: fhir4.Patient | undefined,
): NursingSummaryReturnedRow {
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    compositionId: task.focus?.reference?.match(/^Composition\/(.+)$/)?.[1] ?? "",
    summaryLabel: taskInputOf(task, SUMMARY_LABEL_INPUT)?.valueString ?? "",
    reason: nursingSummaryReturnReason(task),
    requesterName: task.requester?.display ?? "",
  };
}
