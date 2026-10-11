import { dateTimeLabel } from "../lib/dates";
import {
  buildCancelledNotificationTask,
  buildCompletedNotificationTask,
  buildNotificationTask,
  hasTaskCode,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";
import { buildInjectionTaskUpdate, isInjectionTask } from "./injectionTaskHelpers";
import { orderRequester } from "./orderHeader";
import { RX_TASK_CODE, buildRxTaskUpdate } from "./rxTaskHelpers";
import { transactionBundle } from "./shared";

// 疑義照会(処方・注射)。薬剤部が処方医に問い合わせ、処方医が回答する。
//
//   ServiceRequest(オーダー) ← focus ── Task rx-inquiry(照会 1 件。宛先 = 処方医)
//                            ← focus ── Task rx-inquiry-answered(回答の通知。宛先 = 照会した薬剤師)
//                            ← focus ── Task 進捗(調剤 / 注射)。照会中は on-hold
//
// 照会は通知(Task)そのもの。照会内容は input、回答は output(回答区分と回答文)に持つ。
// 返事を相手あての新しい通知にするのは、カウンターサインの差戻し(note-returned)と同じ形。
//
// 照会中は進捗を on-hold にして、調剤登録・払出登録を出さない。回答が「処方を変更する」なら
// 処方医がオーダーを編集して保存するまで on-hold(処方変更待ち)のまま残す。

export const RX_INQUIRY_TASK_CODE = { code: "rx-inquiry", display: "疑義照会" };
export const RX_INQUIRY_ANSWERED_TASK_CODE = { code: "rx-inquiry-answered", display: "疑義照会回答" };

export const RX_INQUIRY_ANSWERED_NOTE = "回答を確認しました。";
/** 調剤登録・払出登録で回答の通知を閉じるときの記録。 */
export const RX_INQUIRY_DISPENSED_NOTE = "回答を受けて調剤しました。";
const RX_INQUIRY_ANSWER_NOTE = "回答しました。";

/** 照会したオーダーの種別。どちらの部門一覧・詳細を開くかに使う。 */
export type RxInquiryOrderKind = "prescription" | "injection";

const ANSWER_SYSTEM = "http://fhir-client.local/CodeSystem/rx-inquiry-answer";
/** 進捗を止めている理由(Task.statusReason)。 */
const HOLD_REASON_SYSTEM = "http://fhir-client.local/CodeSystem/rx-hold-reason";

export const RX_INQUIRY_ANSWER_OPTIONS = [
  { code: "as-ordered", display: "処方どおり" },
  { code: "pharmacy-change", display: "薬剤部で変更してよい" },
  { code: "order-change", display: "処方を変更する" },
] as const;

export type RxInquiryAnswer = (typeof RX_INQUIRY_ANSWER_OPTIONS)[number]["code"];

export function rxInquiryAnswerLabel(code: string | undefined): string {
  return RX_INQUIRY_ANSWER_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

/** 進捗を止めている理由。照会の回答待ちと、回答を受けた処方の変更待ち。 */
export type RxHoldReason = "inquiry" | "order-change";

const HOLD_REASON_LABELS: Record<RxHoldReason, string> = {
  inquiry: "照会中",
  "order-change": "処方変更待ち",
};

// input / output のキー(type.text)。
const QUESTION_KEY = "照会内容";
const ORDER_KIND_KEY = "オーダー種別";
const ORDER_LABEL_KEY = "オーダー";
const ANSWER_KIND_KEY = "回答区分";
const ANSWER_TEXT_KEY = "回答";

/** 進捗 Task を組み立てる関数(処方は buildRxTaskUpdate、注射は buildInjectionTaskUpdate)。 */
export type ProgressBuilder = (
  task: fhir4.Task | undefined,
  order: fhir4.ServiceRequest,
  status: "accepted" | "on-hold",
) => fhir4.Task;

/** 種別ごとの進捗の組み立て。 */
export function progressBuilderOf(kind: RxInquiryOrderKind): ProgressBuilder {
  return kind === "injection" ? buildInjectionTaskUpdate : buildRxTaskUpdate;
}

/** オーダーを焦点にする Task のうち、その種別の進捗。まだ無ければ undefined。 */
export function progressOf(kind: RxInquiryOrderKind, tasks: fhir4.Task[]): fhir4.Task | undefined {
  return tasks.find((task) =>
    kind === "injection" ? isInjectionTask(task) : hasTaskCode(task, RX_TASK_CODE.code),
  );
}

export interface RxInquiryActor {
  practitionerId: string;
  display: string;
}

function practitionerReference(actor: RxInquiryActor): fhir4.Reference {
  return { reference: `Practitioner/${actor.practitionerId}`, display: actor.display };
}

function stringInput(key: string, value: string): fhir4.TaskInput {
  return { type: { text: key }, valueString: value };
}

function taskEntry(task: fhir4.Task): fhir4.BundleEntry {
  return notificationTaskEntry(task, task.id);
}

/** 進捗を止めている理由。止めていなければ null。 */
export function rxHoldReasonOf(progress: fhir4.Task | undefined): RxHoldReason | null {
  if (progress?.status !== "on-hold") return null;
  const code = progress.statusReason?.coding?.find((c) => c.system === HOLD_REASON_SYSTEM)?.code;
  return code === "order-change" ? "order-change" : "inquiry";
}

export function rxHoldReasonLabel(reason: RxHoldReason): string {
  return HOLD_REASON_LABELS[reason];
}

function heldProgress(
  progress: fhir4.Task | undefined,
  order: fhir4.ServiceRequest,
  build: ProgressBuilder,
  reason: RxHoldReason,
): fhir4.Task {
  return {
    ...build(progress, order, "on-hold"),
    statusReason: {
      coding: [{ system: HOLD_REASON_SYSTEM, code: reason, display: HOLD_REASON_LABELS[reason] }],
      text: HOLD_REASON_LABELS[reason],
    },
  };
}

/** 止めていた進捗を受付済へ戻す。 */
function releasedProgress(
  progress: fhir4.Task | undefined,
  order: fhir4.ServiceRequest,
  build: ProgressBuilder,
): fhir4.Task {
  const next = build(progress, order, "accepted");
  delete next.statusReason;
  return next;
}

/** 照会を出せる処方医(オーダーの依頼医)。依頼医の無いオーダーは照会できない。 */
export function rxInquiryOwnerOf(order: fhir4.ServiceRequest): RxInquiryActor | null {
  const requester = orderRequester(order);
  if (!requester.practitionerId) return null;
  return { practitionerId: requester.practitionerId, display: requester.practitionerName };
}

/** 照会の送信。照会の通知と、進捗を照会中にする更新を 1 つの transaction にする。 */
export function buildRxInquiryBundle(args: {
  kind: RxInquiryOrderKind;
  order: fhir4.ServiceRequest;
  progress: fhir4.Task | undefined;
  buildProgress: ProgressBuilder;
  question: string;
  orderLabel: string;
  pharmacist: RxInquiryActor;
}): fhir4.Bundle {
  const { kind, order, progress, buildProgress, question, orderLabel, pharmacist } = args;
  const owner = rxInquiryOwnerOf(order);
  if (!owner) throw new Error("依頼医師の無いオーダーには疑義照会できません");
  const orderReference = `ServiceRequest/${order.id}`;

  const inquiry = buildNotificationTask({
    code: RX_INQUIRY_TASK_CODE,
    // 回答があるまで調剤・払出を止めているので、お知らせより一段強くする。
    severity: "caution",
    focusReference: orderReference,
    patientId: order.subject?.reference?.split("/").pop() ?? "",
    owner: practitionerReference(owner),
    requester: practitionerReference(pharmacist),
    basedOn: [{ reference: orderReference }],
    description: `疑義照会: ${question}`,
    input: [
      stringInput(QUESTION_KEY, question),
      stringInput(ORDER_KIND_KEY, kind),
      stringInput(ORDER_LABEL_KEY, orderLabel),
    ],
  });

  const held = heldProgress(progress, order, buildProgress, "inquiry");
  return transactionBundle([
    { resource: inquiry, request: { method: "POST", url: "Task" } },
    taskEntry(held),
  ]);
}

/**
 * 回答。照会を対応済みにして output に回答を書き、照会した薬剤師あての回答の通知を作る。
 * 進捗は「処方を変更する」なら処方変更待ちのまま止め、それ以外は受付済へ戻す。
 */
export function buildRxInquiryAnswerBundle(args: {
  inquiry: fhir4.Task;
  order: fhir4.ServiceRequest;
  progress: fhir4.Task | undefined;
  buildProgress: ProgressBuilder;
  answer: RxInquiryAnswer;
  text: string;
  doctor: RxInquiryActor;
}): fhir4.Bundle {
  const { inquiry, order, progress, buildProgress, answer, text, doctor } = args;
  const answered: fhir4.Task = {
    ...buildCompletedNotificationTask(inquiry, doctor, RX_INQUIRY_ANSWER_NOTE),
    output: [
      {
        type: { text: ANSWER_KIND_KEY },
        valueCodeableConcept: {
          coding: [{ system: ANSWER_SYSTEM, code: answer, display: rxInquiryAnswerLabel(answer) }],
        },
      },
      ...(text ? [{ type: { text: ANSWER_TEXT_KEY }, valueString: text }] : []),
    ],
  };

  const entries: fhir4.BundleEntry[] = [taskEntry(answered)];

  if (progress?.status === "on-hold") {
    entries.push(
      taskEntry(
        answer === "order-change"
          ? heldProgress(progress, order, buildProgress, "order-change")
          : releasedProgress(progress, order, buildProgress),
      ),
    );
  }

  // 照会した薬剤師へ回答を知らせる。照会者が分からない照会(古いデータ)には出さない。
  if (inquiry.requester?.reference) {
    const summary = summarizeRxInquiry(inquiry);
    const notice = buildNotificationTask({
      code: RX_INQUIRY_ANSWERED_TASK_CODE,
      severity: "info",
      focusReference: `ServiceRequest/${order.id}`,
      patientId: taskPatientId(inquiry),
      owner: inquiry.requester,
      requester: practitionerReference(doctor),
      basedOn: [{ reference: `ServiceRequest/${order.id}` }],
      description: `疑義照会の回答: ${rxInquiryAnswerLabel(answer)}${text ? ` ${text}` : ""}`,
      input: [
        stringInput(QUESTION_KEY, summary.question),
        stringInput(ORDER_KIND_KEY, summary.orderKind),
        stringInput(ORDER_LABEL_KEY, summary.orderLabel),
        stringInput(ANSWER_KIND_KEY, rxInquiryAnswerLabel(answer)),
        ...(text ? [stringInput(ANSWER_TEXT_KEY, text)] : []),
      ],
    });
    entries.push({ resource: notice, request: { method: "POST", url: "Task" } });
  }

  return transactionBundle(entries);
}

/** 照会の取下げ。照会を取り消し、進捗を受付済へ戻す。 */
export function buildRxInquiryWithdrawBundle(args: {
  inquiry: fhir4.Task;
  order: fhir4.ServiceRequest;
  progress: fhir4.Task | undefined;
  buildProgress: ProgressBuilder;
}): fhir4.Bundle {
  const { inquiry, order, progress, buildProgress } = args;
  const entries = [taskEntry(buildCancelledNotificationTask(inquiry))];
  if (progress?.status === "on-hold") {
    entries.push(taskEntry(releasedProgress(progress, order, buildProgress)));
  }
  return transactionBundle(entries);
}

/**
 * オーダーの編集を保存するときに足すエントリ。「処方を変更する」と回答して処方変更待ちに
 * なっている進捗を、変更が済んだものとして受付済へ戻す。待っていなければ何も足さない。
 */
export function rxOrderChangeReleaseEntries(
  order: fhir4.ServiceRequest,
  progress: fhir4.Task | undefined,
  buildProgress: ProgressBuilder,
): fhir4.BundleEntry[] {
  if (rxHoldReasonOf(progress) !== "order-change") return [];
  return [taskEntry(releasedProgress(progress, order, buildProgress))];
}

/** 調剤登録・払出登録で、そのオーダーの未確認の回答通知を閉じるエントリ。 */
export function closeRxInquiryNoticeEntries(
  notices: fhir4.Task[],
  actor: RxInquiryActor,
): fhir4.BundleEntry[] {
  return notices
    .filter((task) => task.status === "requested" && hasTaskCode(task, RX_INQUIRY_ANSWERED_TASK_CODE.code))
    .map((task) => taskEntry(buildCompletedNotificationTask(task, actor, RX_INQUIRY_DISPENSED_NOTE)));
}

// ---- 読み出し ----

export type RxInquiryState = "open" | "answered" | "withdrawn";

export interface RxInquirySummary {
  task: fhir4.Task;
  id: string;
  state: RxInquiryState;
  orderKind: RxInquiryOrderKind;
  orderLabel: string;
  question: string;
  askedAt: string;
  askedBy: string;
  /** 宛先(処方医)。 */
  ownerName: string;
  answer: RxInquiryAnswer | "";
  answerLabel: string;
  answerText: string;
  answeredAt: string;
  answeredBy: string;
}

function outputOf(task: fhir4.Task, key: string): fhir4.TaskOutput | undefined {
  return (task.output ?? []).find((output) => output.type?.text === key);
}

export function isRxInquiryTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, RX_INQUIRY_TASK_CODE.code);
}

export function summarizeRxInquiry(task: fhir4.Task): RxInquirySummary {
  const answer = (outputOf(task, ANSWER_KIND_KEY)?.valueCodeableConcept?.coding?.[0]?.code ?? "") as
    | RxInquiryAnswer
    | "";
  const kind = taskInputOf(task, ORDER_KIND_KEY)?.valueString;
  return {
    task,
    id: task.id ?? "",
    state: task.status === "completed" ? "answered" : task.status === "cancelled" ? "withdrawn" : "open",
    orderKind: kind === "injection" ? "injection" : "prescription",
    orderLabel: taskInputOf(task, ORDER_LABEL_KEY)?.valueString ?? "",
    question: taskInputOf(task, QUESTION_KEY)?.valueString ?? "",
    askedAt: task.authoredOn ?? "",
    askedBy: task.requester?.display ?? "",
    ownerName: taskOwnerName(task),
    answer,
    answerLabel: rxInquiryAnswerLabel(answer),
    answerText: outputOf(task, ANSWER_TEXT_KEY)?.valueString ?? "",
    answeredAt: task.status === "completed" ? (task.executionPeriod?.end ?? "") : "",
    answeredBy: task.status === "completed" ? (task.note?.[0]?.authorReference?.display ?? "") : "",
  };
}

/** ServiceRequest の id → その照会の Task。部門一覧の行に添える。 */
export function rxInquiryTasksByOrderId(tasks: fhir4.Task[]): Map<string, fhir4.Task[]> {
  const byOrderId = new Map<string, fhir4.Task[]>();
  for (const task of tasks) {
    if (!isRxInquiryTask(task)) continue;
    const orderId = task.focus?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
    if (!orderId) continue;
    byOrderId.set(orderId, [...(byOrderId.get(orderId) ?? []), task]);
  }
  return byOrderId;
}

/** オーダーの照会(古い順)。 */
export function rxInquiriesOf(tasks: fhir4.Task[]): RxInquirySummary[] {
  return tasks
    .filter(isRxInquiryTask)
    .map(summarizeRxInquiry)
    .sort((a, b) => a.askedAt.localeCompare(b.askedAt));
}

/** 未回答の照会。1 オーダーに同時に出せるのは 1 件。 */
export function openRxInquiryOf(tasks: fhir4.Task[]): RxInquirySummary | undefined {
  return rxInquiriesOf(tasks).find((inquiry) => inquiry.state === "open");
}

/** カルテのカードに出す疑義照会の状態。未回答の照会があれば「疑義照会中」、回答を受けて処方の変更を待っていれば「処方変更待ち」。 */
export function rxInquiryBadge(inquiries: fhir4.Task[], progress: fhir4.Task | undefined): string {
  if (openRxInquiryOf(inquiries)) return "疑義照会中";
  return rxHoldReasonOf(progress) === "order-change" ? "処方変更待ち" : "";
}

/** 一覧の印に出す、最後に回答があった照会の回答区分。 */
export function latestRxInquiryAnswerLabel(tasks: fhir4.Task[]): string {
  const answered = rxInquiriesOf(tasks).filter((inquiry) => inquiry.state === "answered");
  return answered[answered.length - 1]?.answerLabel ?? "";
}

export function rxInquiryTimeLabel(value: string): string {
  return dateTimeLabel(value);
}

// ---- 通知一覧の行 ----

export interface RxInquiryRow extends NotificationRowBase {
  orderId: string;
  orderKind: RxInquiryOrderKind;
  orderLabel: string;
  question: string;
  requesterName: string;
}

export function rxInquiryRowOf(task: fhir4.Task, patient: fhir4.Patient | undefined): RxInquiryRow {
  const summary = summarizeRxInquiry(task);
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    orderId: task.focus?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1] ?? "",
    orderKind: summary.orderKind,
    orderLabel: summary.orderLabel,
    question: summary.question,
    requesterName: summary.askedBy,
  };
}

export interface RxInquiryAnsweredRow extends RxInquiryRow {
  answerLabel: string;
  answerText: string;
}

export function rxInquiryAnsweredRowOf(
  task: fhir4.Task,
  patient: fhir4.Patient | undefined,
): RxInquiryAnsweredRow {
  return {
    ...rxInquiryRowOf(task, patient),
    answerLabel: taskInputOf(task, ANSWER_KIND_KEY)?.valueString ?? "",
    answerText: taskInputOf(task, ANSWER_TEXT_KEY)?.valueString ?? "",
  };
}
