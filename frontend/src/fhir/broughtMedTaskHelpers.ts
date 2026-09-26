import { nowFhirDateTime } from "../lib/dates";
import {
  encounterAdmissionDate,
  encounterAttendingId,
  encounterAttendingName,
} from "./encounterHelpers";
import {
  buildCompletedNotificationTask,
  buildNotificationTask,
  completeNotificationEntry,
  hasTaskCode,
  latestOf,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";
import { TASK_CODE_SYSTEM } from "./taskHelpers";

// 持参薬の鑑別依頼(薬剤部の進捗)と、鑑別済の通知(主治医あて)。
//
//   Encounter(入院) ← focus ── Task[brought-med-review](鑑別依頼。1 入院に閉じていないもの 1 件)
//   Encounter(入院) ← focus ── Task[brought-med-identified](鑑別済の通知。owner = 主治医)
//
// 鑑別依頼は部門進捗と同じ語彙だが、焦点が ServiceRequest ではなく入院なので
// createTaskHelpers を使わずにここで組み立てる(docs/brought-medication-design.md §3)。

export const BROUGHT_MED_REVIEW_TASK_CODE = { code: "brought-med-review", display: "持参薬鑑別" };
export const BROUGHT_MED_IDENTIFIED_TASK_CODE = {
  code: "brought-med-identified",
  display: "持参薬鑑別済",
};

/** 対応済みにしたときに通知へ残す文。 */
export const BROUGHT_MED_IDENTIFIED_NOTE = "持参薬の継続・中止を判断しました。";

export type BroughtMedReviewStatus = "requested" | "in-progress" | "completed" | "cancelled";

export const BROUGHT_MED_REVIEW_STATUS_OPTIONS: { code: BroughtMedReviewStatus; display: string }[] = [
  { code: "requested", display: "依頼済" },
  { code: "in-progress", display: "鑑別中" },
  { code: "completed", display: "鑑別済" },
  { code: "cancelled", display: "取消" },
];

export function broughtMedReviewStatusDisplay(status: string | undefined): string {
  return BROUGHT_MED_REVIEW_STATUS_OPTIONS.find((o) => o.code === status)?.display ?? status ?? "";
}

const WARD_INPUT = "病棟";
const ADMISSION_DATE_INPUT = "入院日";
const ENCOUNTER_INPUT = "入院";

export function isBroughtMedReviewTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, BROUGHT_MED_REVIEW_TASK_CODE.code);
}

/** 閉じていない(依頼済・鑑別中の)鑑別依頼か。 */
export function isOpenBroughtMedReview(task: fhir4.Task): boolean {
  return isBroughtMedReviewTask(task) && (task.status === "requested" || task.status === "in-progress");
}

/**
 * 鑑別依頼。病棟・入院日は一覧で入院を引き直さずに出せるよう input に焼き付ける
 * (上流の `_include=Task:focus` は ServiceRequest しか返さない)。
 */
export function buildBroughtMedReviewTask(params: {
  patientId: string;
  encounterId: string;
  wardName: string;
  admissionDate: string;
  requester?: { practitionerId: string; display: string };
}): fhir4.Task {
  const now = nowFhirDateTime();
  return {
    resourceType: "Task",
    status: "requested",
    intent: "order",
    code: {
      coding: [{ system: TASK_CODE_SYSTEM, ...BROUGHT_MED_REVIEW_TASK_CODE }],
      text: BROUGHT_MED_REVIEW_TASK_CODE.display,
    },
    focus: { reference: `Encounter/${params.encounterId}` },
    for: { reference: `Patient/${params.patientId}` },
    encounter: { reference: `Encounter/${params.encounterId}` },
    authoredOn: now,
    lastModified: now,
    ...(params.requester
      ? {
          requester: {
            reference: `Practitioner/${params.requester.practitionerId}`,
            display: params.requester.display,
          },
        }
      : {}),
    input: [
      ...(params.wardName ? [{ type: { text: WARD_INPUT }, valueString: params.wardName }] : []),
      ...(params.admissionDate
        ? [{ type: { text: ADMISSION_DATE_INPUT }, valueDate: params.admissionDate }]
        : []),
    ],
  };
}

/**
 * 状態を変えた鑑別依頼。executionPeriod は薬剤部が作業した時間帯で、鑑別開始で start、
 * 鑑別済で end を入れる。依頼済に戻すと落とす。
 */
export function buildBroughtMedReviewUpdate(
  task: fhir4.Task,
  status: BroughtMedReviewStatus,
  actor?: { practitionerId: string; display: string },
): fhir4.Task {
  const now = latestOf(nowFhirDateTime(), task.authoredOn);
  const next: fhir4.Task = { ...task, status, lastModified: now };
  if (status === "requested" || status === "cancelled") {
    delete next.executionPeriod;
    delete next.owner;
  } else {
    const start = task.executionPeriod?.start ?? now;
    next.executionPeriod = status === "completed" ? { start, end: now } : { start };
    if (actor) {
      next.owner = { reference: `Practitioner/${actor.practitionerId}`, display: actor.display };
    }
  }
  return next;
}

export function broughtMedReviewEntry(task: fhir4.Task, fullUrl?: string): fhir4.BundleEntry {
  if (task.id) {
    return {
      resource: task,
      request: {
        method: "PUT",
        url: `Task/${task.id}`,
        ...(task.meta?.versionId ? { ifMatch: `W/"${task.meta.versionId}"` } : {}),
      },
    };
  }
  return {
    fullUrl: fullUrl ?? `urn:uuid:${crypto.randomUUID()}`,
    resource: task,
    request: { method: "POST", url: "Task" },
  };
}

export interface BroughtMedReviewRow {
  task: fhir4.Task;
  patientId: string;
  encounterId: string;
  wardName: string;
  admissionDate: string;
  authoredOn: string;
  status: BroughtMedReviewStatus;
  ownerName: string;
}

export function broughtMedReviewRowOf(task: fhir4.Task): BroughtMedReviewRow {
  const status = BROUGHT_MED_REVIEW_STATUS_OPTIONS.some((o) => o.code === task.status)
    ? (task.status as BroughtMedReviewStatus)
    : "requested";
  return {
    task,
    patientId: taskPatientId(task),
    encounterId: task.encounter?.reference?.split("/").pop() ?? "",
    wardName: taskInputOf(task, WARD_INPUT)?.valueString ?? "",
    admissionDate: taskInputOf(task, ADMISSION_DATE_INPUT)?.valueDate ?? "",
    authoredOn: task.authoredOn ?? "",
    status,
    ownerName: taskOwnerName(task),
  };
}

// ---- 鑑別済の通知 ----

export function isBroughtMedIdentifiedTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, BROUGHT_MED_IDENTIFIED_TASK_CODE.code);
}

/** 鑑別済の通知。宛先は入院の主治医(無ければ宛先なし)。 */
export function broughtMedIdentifiedEntry(
  encounter: fhir4.Encounter,
  patientId: string,
  counts: { total: number; undecided: number },
  actor?: { practitionerId: string; display: string },
): fhir4.BundleEntry | null {
  if (!encounter.id) return null;
  const attendingId = encounterAttendingId(encounter);
  const admissionDate = encounterAdmissionDate(encounter);
  const task = buildNotificationTask({
    code: BROUGHT_MED_IDENTIFIED_TASK_CODE,
    severity: "info",
    focusReference: `Encounter/${encounter.id}`,
    patientId,
    owner: attendingId
      ? { reference: `Practitioner/${attendingId}`, display: encounterAttendingName(encounter) }
      : undefined,
    requester: actor
      ? { reference: `Practitioner/${actor.practitionerId}`, display: actor.display }
      : undefined,
    description: `持参薬 ${counts.total} 剤の鑑別が済みました(判断待ち ${counts.undecided} 剤)`,
    input: [
      { type: { text: ENCOUNTER_INPUT }, valueReference: { reference: `Encounter/${encounter.id}` } },
      ...(admissionDate !== "-"
        ? [{ type: { text: ADMISSION_DATE_INPUT }, valueDate: admissionDate }]
        : []),
      { type: { text: "剤数" }, valueInteger: counts.total },
      { type: { text: "判断待ち" }, valueInteger: counts.undecided },
    ],
  });
  task.encounter = { reference: `Encounter/${encounter.id}` };
  return notificationTaskEntry(task);
}

/** 判断が出揃ったときに通知を閉じる entry。 */
export function completeBroughtMedIdentifiedEntries(
  tasks: fhir4.Task[],
  actor: { practitionerId: string; display: string },
): fhir4.BundleEntry[] {
  return tasks
    .filter((task) => task.id && task.status === "requested" && isBroughtMedIdentifiedTask(task))
    .map((task) =>
      completeNotificationEntry(buildCompletedNotificationTask(task, actor, BROUGHT_MED_IDENTIFIED_NOTE)),
    );
}

export interface BroughtMedIdentifiedRow extends NotificationRowBase {
  encounterId: string;
  admissionDate: string;
  total: number;
  undecided: number;
}

export function broughtMedIdentifiedRowOf(
  task: fhir4.Task,
  patient: fhir4.Patient | undefined,
): BroughtMedIdentifiedRow {
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    encounterId:
      taskInputOf(task, ENCOUNTER_INPUT)?.valueReference?.reference?.split("/").pop() ?? "",
    admissionDate: taskInputOf(task, ADMISSION_DATE_INPUT)?.valueDate ?? "",
    total: taskInputOf(task, "剤数")?.valueInteger ?? 0,
    undecided: taskInputOf(task, "判断待ち")?.valueInteger ?? 0,
  };
}
