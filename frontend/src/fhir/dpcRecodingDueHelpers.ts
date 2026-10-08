import { encounterAttendingId, encounterAttendingName } from "./encounterHelpers";
import {
  buildCancelledNotificationTask,
  buildCompletedNotificationTask,
  buildNotificationTask,
  completeNotificationEntry,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";

// DPC の再判定の督促(通知 Task)。
//
// 転棟で病棟が変わったら、診断群分類を「転棟時」で決め直すよう入院の主治医に知らせる。
// 定期実行の主体が無いので、転科・転棟の実施を書く transaction に entry を足す
// (文書作成の督促と同じ作り)。転棟時・退院時の決定を保存すると閉じ、入院取消で取り下げる。
// 月末の再判定は通知を作らず、DPC患者一覧・入院患者一覧の表示で知らせる(dpcPatientList.ts)。

export const DPC_RECODING_DUE_TASK_CODE = { code: "dpc-recoding-due", display: "DPC再判定" };

/** 対応済みにしたときに通知へ残す文。 */
export const DPC_RECODING_DUE_NOTE = "診断群分類を判定しました。";

/** この時点の決定を保存したら督促を閉じる(転棟後に退院まで決めなかった場合も退院時で閉じる)。 */
export const DPC_RECODING_CLOSING_TIMINGS = ["transfer", "discharge"];

const ENCOUNTER_INPUT = "入院";
const TRANSFER_DATE_INPUT = "転棟日";
const FROM_WARD_INPUT = "転棟元";
const TO_WARD_INPUT = "転棟先";

/**
 * 転棟の再判定の督促 Task を作る entry。宛先は入院の主治医(無ければ宛先なし)。
 * focus と encounter に入院を持たせ、`Task?code=dpc-recoding-due&encounter=` で引けるようにする。
 */
export function dpcTransferRecodingDueEntry(
  encounter: fhir4.Encounter,
  patientId: string,
  transfer: { date: string; fromWard: string; toWard: string },
): fhir4.BundleEntry | null {
  if (!encounter.id) return null;
  const attendingId = encounterAttendingId(encounter);
  const task = buildNotificationTask({
    code: DPC_RECODING_DUE_TASK_CODE,
    severity: "info",
    focusReference: `Encounter/${encounter.id}`,
    patientId,
    owner: attendingId
      ? { reference: `Practitioner/${attendingId}`, display: encounterAttendingName(encounter) }
      : undefined,
    description: `転棟(${transfer.date} ${transfer.fromWard} → ${transfer.toWard})の診断群分類が未判定`,
    input: [
      { type: { text: ENCOUNTER_INPUT }, valueReference: { reference: `Encounter/${encounter.id}` } },
      { type: { text: TRANSFER_DATE_INPUT }, valueDate: transfer.date },
      { type: { text: FROM_WARD_INPUT }, valueString: transfer.fromWard },
      { type: { text: TO_WARD_INPUT }, valueString: transfer.toWard },
    ],
  });
  task.encounter = { reference: `Encounter/${encounter.id}` };
  return notificationTaskEntry(task);
}

/** 転棟時・退院時の決定を保存したときに督促を閉じる entry。 */
export function buildCompletedDpcRecodingDueEntries(
  tasks: fhir4.Task[],
  actor: { practitionerId: string; display: string },
): fhir4.BundleEntry[] {
  return tasks
    .filter((task) => task.id && task.status === "requested")
    .map((task) => completeNotificationEntry(buildCompletedNotificationTask(task, actor, DPC_RECODING_DUE_NOTE)));
}

/** 未対応の督促を取り下げる entry(入院取消)。 */
export function cancelDpcRecodingDueEntries(tasks: fhir4.Task[]): fhir4.BundleEntry[] {
  return tasks
    .filter((task) => task.id && task.status === "requested")
    .map((task) => notificationTaskEntry(buildCancelledNotificationTask(task), task.id));
}

export interface DpcRecodingDueRow extends NotificationRowBase {
  encounterId: string;
  transferDate: string;
  fromWard: string;
  toWard: string;
}

export function dpcRecodingDueRowOf(task: fhir4.Task, patient: fhir4.Patient | undefined): DpcRecodingDueRow {
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    encounterId: taskInputOf(task, ENCOUNTER_INPUT)?.valueReference?.reference?.split("/").pop() ?? "",
    transferDate: taskInputOf(task, TRANSFER_DATE_INPUT)?.valueDate ?? "",
    fromWard: taskInputOf(task, FROM_WARD_INPUT)?.valueString ?? "",
    toWard: taskInputOf(task, TO_WARD_INPUT)?.valueString ?? "",
  };
}
