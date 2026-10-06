import { nowFhirDateTime } from "../lib/dates";
import { isCountersignNote } from "./clinicalNoteHelpers";
import {
  buildCancelledNotificationTask,
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
import type { OrderEnterer } from "./provenanceHelpers";

// 研修医・学生の診療記録のカウンターサイン(docs/countersign-design.md)。
//
// 器は看護サマリーの承認と同じ Composition の attester。
//   承認待ち  final / amended + attester(legal = 研修医)で professional が無い
//   承認済    attester(professional = 指導医)を足す
//   差戻し    preliminary に戻して attester を外す。理由は差戻しの通知 Task に持つ
//   再確定    研修医が確定し直すと legal だけになり(professional は buildAttester が落とす)、
//             また承認待ちになる
// 対象かどうかは Composition.category の印(clinicalNoteHelpers の COUNTERSIGN_CATEGORY)で見る。
//
// 通知は 2 種類。承認待ち(note-countersign)は指導医ごとに 1 件、差戻し(note-returned)は
// 研修医あてに 1 件。指導医のコメントは承認待ちの Task の note に積む(印の拡張で対応の記録と
// 見分ける)。誰かが承認・差戻しすると、その人の Task を対応済み、残りの指導医の Task を取り下げる。

export const NOTE_COUNTERSIGN_TASK_CODE = { code: "note-countersign", display: "カルテ承認" };
export const NOTE_RETURNED_TASK_CODE = { code: "note-returned", display: "カルテ差戻し" };

export const NOTE_COUNTERSIGN_NOTE = "記録を承認しました。";
export const NOTE_RETURN_NOTE = "記録を差し戻しました。";
export const NOTE_RETURNED_DONE_NOTE = "記録を確定し直しました。";

/** 指導医のコメントの印。対応済みの記録(buildCompletedNotificationTask が書く note)と見分ける。 */
const COMMENT_EXT_URL = "http://fhir-client.local/StructureDefinition/task-note-comment";

const NOTE_LABEL_INPUT = "記録";
const TRAINEE_INPUT = "研修医";
const REASON_INPUT = "理由";

export interface Supervisor {
  practitionerId: string;
  display: string;
}

export type CountersignState = "draft" | "returned" | "pending" | "approved";

export const COUNTERSIGN_STATE_LABELS: Record<CountersignState, string> = {
  draft: "作成中",
  returned: "差戻し",
  pending: "承認待ち",
  approved: "承認済",
};

function practitionerIdOf(reference: fhir4.Reference | undefined): string {
  return reference?.reference?.match(/^Practitioner\/(.+)$/)?.[1] ?? "";
}

export function noteAuthorId(composition: fhir4.Composition): string {
  return practitionerIdOf(composition.author?.[0]);
}

/** 承認した指導医。未承認なら null。 */
export function countersignApprover(
  composition: fhir4.Composition,
): { id: string; name: string; time: string } | null {
  const professional = composition.attester?.find((a) => a.mode === "professional");
  if (!professional) return null;
  return {
    id: practitionerIdOf(professional.party),
    name: professional.party?.display ?? "",
    time: professional.time ?? "",
  };
}

/** 状態。returned は未対応の差戻しの通知があるか(呼ぶ側が渡す。無ければ作成中と区別しない)。 */
export function countersignStateOf(composition: fhir4.Composition, returned: boolean): CountersignState {
  if (composition.status === "preliminary") return returned ? "returned" : "draft";
  return countersignApprover(composition) ? "approved" : "pending";
}

/**
 * タイムラインのカードに出す印。対象の記録が確定していれば承認待ちか承認済み。
 * 作成中(差戻しを含む)は出さない(通知を引き直さずに Composition だけで決める)。
 */
export function countersignBadgeOf(composition: fhir4.Composition): "pending" | "approved" | null {
  if (!isCountersignNote(composition) || composition.status === "preliminary") return null;
  return countersignApprover(composition) ? "approved" : "pending";
}

/** 「初診時記録（2026-10-06）」。通知と一覧の見出し。 */
export function noteLabelOf(composition: fhir4.Composition): string {
  return `${composition.title || "診療記録"}（${(composition.date ?? "").slice(0, 10)}）`;
}

/**
 * カウンターサインできる人か。対象の記録が承認待ちで、記録した研修医の指導医であること
 * (trainees は呼ぶ側が受け持つ研修医の id で渡す)。本人は承認できない。
 */
export function canCountersignNote(
  composition: fhir4.Composition,
  practitionerId: string | null,
  trainees: Set<string>,
): boolean {
  if (!practitionerId || !isCountersignNote(composition)) return false;
  if (countersignStateOf(composition, false) !== "pending") return false;
  const author = noteAuthorId(composition);
  return author !== practitionerId && trainees.has(author);
}

/** 承認。内容は変えず、研修医の署名を残して指導医の署名(professional)を足す。 */
export function buildCountersignedNote(composition: fhir4.Composition, approver: OrderEnterer): fhir4.Composition {
  return {
    ...composition,
    attester: [
      ...(composition.attester ?? []).filter((a) => a.mode !== "professional"),
      {
        mode: "professional",
        time: nowFhirDateTime(),
        party: { reference: `Practitioner/${approver.practitionerId}`, display: approver.display || undefined },
      },
    ],
  };
}

/** 差戻し。作成中に戻して署名を外す(理由は差戻しの通知 Task に持つ)。 */
export function buildReturnedNote(composition: fhir4.Composition): fhir4.Composition {
  const next: fhir4.Composition = { ...composition, status: "preliminary" };
  delete next.attester;
  return next;
}

// ---- 通知 Task ----

/** 承認待ちの通知。指導医ごとに 1 件。指導医が登録されていなければ空。 */
export function buildNoteCountersignEntries(args: {
  /** 記録の参照。新規なら同じ Bundle の fullUrl(urn:uuid:)。 */
  focusReference: string;
  patientId: string;
  noteLabel: string;
  trainee: OrderEnterer;
  supervisors: Supervisor[];
  encounter?: fhir4.Reference;
}): fhir4.BundleEntry[] {
  return args.supervisors.map((supervisor) => {
    const task = buildNotificationTask({
      code: NOTE_COUNTERSIGN_TASK_CODE,
      // 承認は遅れても診療は止まらない。
      severity: "info",
      focusReference: args.focusReference,
      patientId: args.patientId,
      owner: { reference: `Practitioner/${supervisor.practitionerId}`, display: supervisor.display || undefined },
      requester: { reference: `Practitioner/${args.trainee.practitionerId}`, display: args.trainee.display || undefined },
      description: `${args.noteLabel} のカウンターサイン（研修医: ${args.trainee.display}）`,
      input: [
        { type: { text: NOTE_LABEL_INPUT }, valueString: args.noteLabel },
        { type: { text: TRAINEE_INPUT }, valueString: args.trainee.display },
      ],
    });
    if (args.encounter) task.encounter = args.encounter;
    return notificationTaskEntry(task);
  });
}

/** 差戻しの通知。記録した研修医あてに理由を添える。 */
export function buildNoteReturnedEntry(args: {
  composition: fhir4.Composition;
  patientId: string;
  reason: string;
  approver: OrderEnterer;
}): fhir4.BundleEntry {
  const author = args.composition.author?.[0];
  const noteLabel = noteLabelOf(args.composition);
  const task = buildNotificationTask({
    code: NOTE_RETURNED_TASK_CODE,
    severity: "info",
    focusReference: `Composition/${args.composition.id}`,
    patientId: args.patientId,
    owner: author?.reference ? { reference: author.reference, display: author.display } : undefined,
    requester: { reference: `Practitioner/${args.approver.practitionerId}`, display: args.approver.display || undefined },
    description: `${noteLabel} 差戻し: ${args.reason}`,
    input: [
      { type: { text: NOTE_LABEL_INPUT }, valueString: noteLabel },
      { type: { text: REASON_INPUT }, valueString: args.reason },
    ],
  });
  if (args.composition.encounter) task.encounter = args.composition.encounter;
  return notificationTaskEntry(task);
}

/**
 * 承認・差戻しのときに承認待ちの通知を閉じる entry。自分あてのものは対応済み(noteText を
 * 残す)、他の指導医あてのものは取り下げる。コメントは消さない。
 */
export function closeNoteCountersignEntries(
  tasks: fhir4.Task[],
  actor: OrderEnterer,
  noteText: string,
): fhir4.BundleEntry[] {
  return tasks
    .filter((task) => task.id && task.status === "requested" && hasTaskCode(task, NOTE_COUNTERSIGN_TASK_CODE.code))
    .map((task) => {
      if (task.owner?.reference !== `Practitioner/${actor.practitionerId}`) {
        return completeNotificationEntry(buildCancelledNotificationTask(task));
      }
      const done = buildCompletedNotificationTask(task, actor, noteText);
      return completeNotificationEntry({ ...done, note: [...commentsOf(task), ...(done.note ?? [])] });
    });
}

/** 確定し直したときに差戻しの通知を閉じる entry。 */
export function closeNoteReturnedEntries(tasks: fhir4.Task[], actor: OrderEnterer): fhir4.BundleEntry[] {
  return tasks
    .filter((task) => task.id && task.status === "requested" && hasTaskCode(task, NOTE_RETURNED_TASK_CODE.code))
    .map((task) => completeNotificationEntry(buildCompletedNotificationTask(task, actor, NOTE_RETURNED_DONE_NOTE)));
}

export function noteReturnReason(task: fhir4.Task): string {
  return taskInputOf(task, REASON_INPUT)?.valueString ?? "";
}

// ---- 指導医のコメント(承認待ちの Task の note) ----

export interface NoteComment {
  taskId: string;
  /** その Task の note の中での位置。直す・消すときに使う。 */
  index: number;
  authorId: string;
  authorName: string;
  time: string;
  text: string;
}

function isComment(note: fhir4.Annotation): boolean {
  return Boolean(note.extension?.some((e) => e.url === COMMENT_EXT_URL && e.valueBoolean));
}

function commentsOf(task: fhir4.Task): fhir4.Annotation[] {
  return (task.note ?? []).filter(isComment);
}

/** その記録へのコメント歴(古い順)。承認・差戻しで閉じた Task のぶんも含む。 */
export function noteCommentsOf(tasks: fhir4.Task[]): NoteComment[] {
  const comments: NoteComment[] = [];
  for (const task of tasks) {
    (task.note ?? []).forEach((note, index) => {
      if (!isComment(note)) return;
      comments.push({
        taskId: task.id ?? "",
        index,
        authorId: practitionerIdOf(note.authorReference),
        authorName: note.authorReference?.display ?? "",
        time: note.time ?? "",
        text: note.text,
      });
    });
  }
  return comments.sort((a, b) => a.time.localeCompare(b.time));
}

/** コメントを足した Task。 */
export function buildCommentedTask(task: fhir4.Task, actor: OrderEnterer, text: string): fhir4.Task {
  const now = latestOf(nowFhirDateTime(), task.authoredOn);
  return {
    ...task,
    lastModified: now,
    note: [
      ...(task.note ?? []),
      {
        extension: [{ url: COMMENT_EXT_URL, valueBoolean: true }],
        authorReference: { reference: `Practitioner/${actor.practitionerId}`, display: actor.display || undefined },
        time: now,
        text,
      },
    ],
  };
}

/** コメントを直した(text)・消した(null)Task。 */
export function buildEditedCommentTask(task: fhir4.Task, index: number, text: string | null): fhir4.Task {
  const notes = [...(task.note ?? [])];
  if (!notes[index]) return task;
  if (text === null) notes.splice(index, 1);
  else notes[index] = { ...notes[index], text };
  return { ...task, lastModified: latestOf(nowFhirDateTime(), task.authoredOn), note: notes };
}

// ---- 一覧の行 ----

export interface NoteCountersignRow extends NotificationRowBase {
  compositionId: string;
  noteLabel: string;
  traineeName: string;
}

export function noteCountersignRowOf(task: fhir4.Task, patient: fhir4.Patient | undefined): NoteCountersignRow {
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    compositionId: task.focus?.reference?.match(/^Composition\/(.+)$/)?.[1] ?? "",
    noteLabel: taskInputOf(task, NOTE_LABEL_INPUT)?.valueString ?? "",
    traineeName: taskInputOf(task, TRAINEE_INPUT)?.valueString ?? task.requester?.display ?? "",
  };
}

export interface NoteReturnedRow extends NotificationRowBase {
  compositionId: string;
  noteLabel: string;
  reason: string;
  requesterName: string;
}

export function noteReturnedRowOf(task: fhir4.Task, patient: fhir4.Patient | undefined): NoteReturnedRow {
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    compositionId: task.focus?.reference?.match(/^Composition\/(.+)$/)?.[1] ?? "",
    noteLabel: taskInputOf(task, NOTE_LABEL_INPUT)?.valueString ?? "",
    reason: noteReturnReason(task),
    requesterName: task.requester?.display ?? "",
  };
}
