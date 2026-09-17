import { addDays, diffDays, today } from "../lib/dates";
import {
  encounterAttendingId,
  encounterAttendingName,
  encounterDischargeDate,
} from "./encounterHelpers";
import {
  buildCancelledNotificationTask,
  buildCompletedNotificationTask,
  buildNotificationTask,
  completeNotificationEntry,
  hasTaskCode,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";

// 文書作成の督促(通知 Task)。
//
// 「退院後 N 日以内に退院時サマリーを書く」のような期限付きの仕事を、退院の時点で
// 期限付きの Task として作る。定期実行の主体がこのシステムに無い(backend にも上流にも
// job/cron が無い)ので、N 日後にサーバーが何かをするのではなく、事象(退院)を書く
// transaction に entry を足し、期限超過は表示時に判定する(既存 5 種別と同じ作り)。
//
// 文書の種別は Task.input で持つ。将来の診療情報提供書の返書やパス終了の督促も
// 同じ種別に載せられる(通知一覧の種別は「文書作成」1 つで、内容欄に文書名が出る)。

export const DOCUMENT_DUE_TASK_CODE = { code: "document-due", display: "文書作成" };

/** 対応済みにしたときに通知へ残す文。 */
export const DOCUMENT_DUE_NOTE = "文書を作成しました。";

const DOCUMENT_INPUT = "文書";
const DOCUMENT_LABEL_INPUT = "文書名";
const ENCOUNTER_INPUT = "入院";
const DISCHARGE_DATE_INPUT = "退院日";
const DUE_DATE_INPUT = "期限";

export const DISCHARGE_SUMMARY_DOCUMENT = "discharge-summary";
const DOCUMENT_LABELS: Record<string, string> = {
  [DISCHARGE_SUMMARY_DOCUMENT]: "退院時サマリー",
};

export function documentLabelOf(code: string): string {
  return DOCUMENT_LABELS[code] ?? code;
}

export function isDocumentDueTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, DOCUMENT_DUE_TASK_CODE.code);
}

/** 施設設定「文書作成の督促」。値は日数。 */
export interface DocumentReminderSettings {
  discharge_summary_days: number;
}

export const DEFAULT_DOCUMENT_REMINDER: DocumentReminderSettings = {
  discharge_summary_days: 14,
};

/**
 * 退院時サマリーの督促 Task を作る entry。宛先は入院の主治医(無ければ宛先なし。
 * 通知一覧で「自分あてのみ」を外すと出る)。focus と encounter に入院を持たせ、
 * 退院取消や確定保存で `Task?code=document-due&encounter=` で引けるようにする。
 */
export function dischargeSummaryDueEntry(
  encounter: fhir4.Encounter,
  patientId: string,
  settings: DocumentReminderSettings,
): fhir4.BundleEntry | null {
  const dischargeDate = encounterDischargeDate(encounter);
  if (!encounter.id || dischargeDate === "-") return null;
  const dueDate = addDays(dischargeDate, settings.discharge_summary_days);
  const attendingId = encounterAttendingId(encounter);
  const task = buildNotificationTask({
    code: DOCUMENT_DUE_TASK_CODE,
    severity: "info",
    focusReference: `Encounter/${encounter.id}`,
    patientId,
    owner: attendingId
      ? { reference: `Practitioner/${attendingId}`, display: encounterAttendingName(encounter) }
      : undefined,
    description: `退院時サマリー 未作成(退院 ${dischargeDate}、期限 ${dueDate})`,
    dueDate,
    input: [
      { type: { text: DOCUMENT_INPUT }, valueCode: DISCHARGE_SUMMARY_DOCUMENT },
      { type: { text: DOCUMENT_LABEL_INPUT }, valueString: documentLabelOf(DISCHARGE_SUMMARY_DOCUMENT) },
      { type: { text: ENCOUNTER_INPUT }, valueReference: { reference: `Encounter/${encounter.id}` } },
      { type: { text: DISCHARGE_DATE_INPUT }, valueDate: dischargeDate },
      { type: { text: DUE_DATE_INPUT }, valueDate: dueDate },
    ],
  });
  task.encounter = { reference: `Encounter/${encounter.id}` };
  return notificationTaskEntry(task);
}

/** 文書を確定したときに督促を閉じる entry。 */
export function buildCompletedDocumentDueEntries(
  tasks: fhir4.Task[],
  actor: { practitionerId: string; display: string },
): fhir4.BundleEntry[] {
  return tasks
    .filter((task) => task.id && task.status === "requested")
    .map((task) => completeNotificationEntry(buildCompletedNotificationTask(task, actor, DOCUMENT_DUE_NOTE)));
}

/** 未対応の督促を取り下げる entry(退院取消)。 */
export function cancelDocumentDueEntries(tasks: fhir4.Task[]): fhir4.BundleEntry[] {
  return tasks
    .filter((task) => task.id && task.status === "requested")
    .map((task) => notificationTaskEntry(buildCancelledNotificationTask(task), task.id));
}

export interface DocumentDueRow extends NotificationRowBase {
  documentCode: string;
  documentLabel: string;
  encounterId: string;
  dischargeDate: string;
  dueDate: string;
  /** 期限を過ぎた日数。期限内なら 0。表示時に今日と比べる(Task には書かない)。 */
  overdueDays: number;
}

export function documentDueRowOf(task: fhir4.Task, patient: fhir4.Patient | undefined): DocumentDueRow {
  const dueDate =
    taskInputOf(task, DUE_DATE_INPUT)?.valueDate ?? task.restriction?.period?.end?.slice(0, 10) ?? "";
  const documentCode = taskInputOf(task, DOCUMENT_INPUT)?.valueCode ?? "";
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    documentCode,
    documentLabel: taskInputOf(task, DOCUMENT_LABEL_INPUT)?.valueString ?? documentLabelOf(documentCode),
    encounterId:
      taskInputOf(task, ENCOUNTER_INPUT)?.valueReference?.reference?.split("/").pop() ?? "",
    dischargeDate: taskInputOf(task, DISCHARGE_DATE_INPUT)?.valueDate ?? "",
    dueDate,
    overdueDays: overdueDaysOf(dueDate),
  };
}

function overdueDaysOf(dueDate: string): number {
  if (!dueDate) return 0;
  const days = diffDays(dueDate, today());
  return Number.isFinite(days) && days > 0 ? days : 0;
}
