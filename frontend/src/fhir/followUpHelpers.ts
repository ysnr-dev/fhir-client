import { diffDays, localDay, nowFhirDateTime, today } from "../lib/dates";
import {
  EXAM_REPORT_KINDS,
  examReportConfigByKind,
  type ExamReportConfig,
  type ExamReportKind,
} from "./examReportHelpers";
import { LAB_PANIC_TASK_CODE } from "./labPanicHelpers";
import { RESULT_REVIEW_TASK_CODE } from "./resultReviewHelpers";
import { TASK_CODE_SYSTEM } from "./taskHelpers";
import {
  buildCancelledNotificationTask,
  buildCompletedNotificationTask,
  buildNotificationTask,
  completeNotificationEntry,
  latestOf,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";

// 検査レポートのフォロー推奨(docs/result-followup-design.md)。
//
//   DiagnosticReport(推奨と期限を拡張に持つ) ← focus ── Task(フォロー推奨) ── owner → 依頼医
//                                                          └ output → 対応区分・対応オーダー
//
// 「6 か月後に CT で再検」のような推奨を、レポートの確定時に期限付きの Task として台帳に載せ、
// 依頼医が対応(オーダー・他院へ依頼など)を記録するまで残す。期限が数か月先になるので通知一覧(ベル)には
// 載せず、検査結果フォロー画面とホームのカードで追う(通知レジストリに登録しない)。

export const FOLLOW_UP_TASK_CODE = { code: "followup-recommendation", display: "フォロー推奨" };

export const FOLLOW_UP_NOTE = "フォロー推奨に対応しました。";

const RESOLUTION_SYSTEM = "http://fhir-client.local/CodeSystem/followup-resolution";

export const FOLLOW_UP_RESOLUTIONS = [
  { code: "ordered", display: "オーダー済" },
  { code: "referred", display: "他院へ依頼" },
  { code: "declined", display: "患者が希望せず" },
  { code: "not-needed", display: "不要と判断" },
] as const;

export type FollowUpResolution = (typeof FOLLOW_UP_RESOLUTIONS)[number]["code"];

export function followUpResolutionDisplay(code: string | undefined): string {
  return FOLLOW_UP_RESOLUTIONS.find((r) => r.code === code)?.display ?? "";
}

// 一覧に出す内容は Task.input に持つ(上流の `_include=Task:focus` は ServiceRequest しか返さない)。
const KIND_INPUT = "種別";
const DATE_INPUT = "検査日";
const EXAM_INPUT = "検査内容";
const RECOMMENDATION_INPUT = "推奨";
const RESOLUTION_OUTPUT = "対応";
const ORDER_OUTPUT = "対応オーダー";

export interface FollowUpTaskInput {
  /** 焦点。同じ transaction で作るレポートは urn:uuid、更新は DiagnosticReport/{id}。 */
  reportReference: string;
  patientId: string;
  /** 宛先(依頼医)。 */
  owner?: fhir4.Reference;
  kind: ExamReportKind;
  /** 検査日(YYYY-MM-DD)。 */
  date: string;
  exam: string;
  recommendation: string;
  /** 期限(YYYY-MM-DD)。 */
  dueDate: string;
  basedOn?: fhir4.Reference[];
}

function buildFollowUpTask(input: FollowUpTaskInput, existing?: fhir4.Task): fhir4.Task {
  const task = buildNotificationTask(
    {
      code: FOLLOW_UP_TASK_CODE,
      severity: "info",
      focusReference: input.reportReference,
      patientId: input.patientId,
      owner: input.owner,
      basedOn: input.basedOn,
      description: [input.date, input.exam, input.recommendation, `期限 ${input.dueDate}`]
        .filter(Boolean)
        .join(" "),
      input: [
        { type: { text: KIND_INPUT }, valueString: input.kind },
        { type: { text: DATE_INPUT }, valueDate: input.date },
        { type: { text: EXAM_INPUT }, valueString: input.exam },
        { type: { text: RECOMMENDATION_INPUT }, valueString: input.recommendation },
      ],
      dueDate: input.dueDate,
    },
    existing,
  );
  // 推奨が変わったら対応も改めてもらうので、前の対応の記録は外す。
  delete task.output;
  return task;
}

function followUpDueOf(task: fhir4.Task): string {
  return task.restriction?.period?.end ?? "";
}

/**
 * レポート保存の transaction に足す entry。推奨は確定(最終・訂正報告)したときに台帳へ載せる。
 *
 *   推奨あり・Task なし(取り下げ済み) → 作る
 *   推奨あり・推奨と期限が同じ          → そのまま(対応済みなら対応を残す)
 *   推奨あり・推奨か期限が変わった      → 書き換えて未対応に戻す
 *   推奨なし・未対応の Task あり         → 取り下げる
 *   推奨なし・対応済みの Task あり       → そのまま(対応した事実は残す)
 */
export function followUpEntries(
  input: FollowUpTaskInput,
  reviewable: boolean,
  existing: fhir4.Task | undefined,
): fhir4.BundleEntry[] {
  const recommendation = input.recommendation.trim();
  if (!recommendation || !input.dueDate) {
    if (existing?.status === "requested") {
      return [notificationTaskEntry(buildCancelledNotificationTask(existing), existing.id)];
    }
    return [];
  }
  if (!reviewable) return [];
  if (
    existing &&
    existing.status !== "cancelled" &&
    taskInputOf(existing, RECOMMENDATION_INPUT)?.valueString === recommendation &&
    followUpDueOf(existing) === input.dueDate
  ) {
    return [];
  }
  return [
    notificationTaskEntry(buildFollowUpTask({ ...input, recommendation }, existing), existing?.id),
  ];
}

export interface FollowUpResolutionInput {
  resolution: FollowUpResolution;
  /** 対応したオーダー(ServiceRequest の id)。無ければ空。 */
  orderId: string;
  orderLabel: string;
  memo: string;
}

/** 対応を記録した Task。誰がいつは note、何をしたかは output に持つ。 */
export function buildResolvedFollowUpTask(
  task: fhir4.Task,
  actor: { practitionerId: string; display: string },
  input: FollowUpResolutionInput,
): fhir4.Task {
  const completed = buildCompletedNotificationTask(task, actor, input.memo.trim() || FOLLOW_UP_NOTE);
  const display = followUpResolutionDisplay(input.resolution);
  completed.output = [
    {
      type: { text: RESOLUTION_OUTPUT },
      valueCodeableConcept: {
        coding: [{ system: RESOLUTION_SYSTEM, code: input.resolution, display }],
        text: display,
      },
    },
    ...(input.orderId
      ? [
          {
            type: { text: ORDER_OUTPUT },
            valueReference: {
              reference: `ServiceRequest/${input.orderId}`,
              display: input.orderLabel || undefined,
            },
          },
        ]
      : []),
  ];
  return completed;
}

export function resolveFollowUpEntry(
  task: fhir4.Task,
  actor: { practitionerId: string; display: string },
  input: FollowUpResolutionInput,
): fhir4.BundleEntry {
  return completeNotificationEntry(buildResolvedFollowUpTask(task, actor, input));
}

/** 対応を取り消して未対応に戻す(記録の誤りを直すため)。 */
export function reopenFollowUpEntry(task: fhir4.Task): fhir4.BundleEntry {
  const reopened: fhir4.Task = {
    ...task,
    status: "requested",
    lastModified: latestOf(nowFhirDateTime(), task.authoredOn),
  };
  delete reopened.output;
  delete reopened.note;
  delete reopened.executionPeriod;
  return completeNotificationEntry(reopened);
}

// ---- 一覧の行 ----

export interface FollowUpRow extends NotificationRowBase {
  reportId: string;
  config: ExamReportConfig | undefined;
  date: string;
  exam: string;
  recommendation: string;
  dueDate: string;
  /** 今日から期限までの日数(過ぎていれば負)。期限が無ければ null。 */
  daysLeft: number | null;
  status: fhir4.Task["status"];
  resolution: string;
  resolvedAt: string;
  resolvedBy: string;
  memo: string;
  orderId: string;
  orderLabel: string;
}

export function followUpRowOf(task: fhir4.Task, patient: fhir4.Patient | undefined): FollowUpRow {
  const dueDate = followUpDueOf(task);
  const resolution = (task.output ?? []).find((o) => o.type?.text === RESOLUTION_OUTPUT);
  const order = (task.output ?? []).find((o) => o.type?.text === ORDER_OUTPUT)?.valueReference;
  const note = task.note?.[0];
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    reportId: task.focus?.reference?.match(/^DiagnosticReport\/(.+)$/)?.[1] ?? "",
    config: examReportConfigByKind(taskInputOf(task, KIND_INPUT)?.valueString ?? ""),
    date: taskInputOf(task, DATE_INPUT)?.valueDate ?? "",
    exam: taskInputOf(task, EXAM_INPUT)?.valueString ?? "",
    recommendation: taskInputOf(task, RECOMMENDATION_INPUT)?.valueString ?? task.description ?? "",
    dueDate,
    daysLeft: dueDate ? diffDays(today(), dueDate) : null,
    status: task.status,
    resolution: resolution?.valueCodeableConcept?.text ?? "",
    resolvedAt: localDay(task.executionPeriod?.end ?? (task.status === "completed" ? task.lastModified : "")),
    resolvedBy: note?.authorReference?.display ?? "",
    memo: note?.text && note.text !== FOLLOW_UP_NOTE ? note.text : "",
    orderId: order?.reference?.split("/").pop() ?? "",
    orderLabel: order?.display ?? "",
  };
}

/** 期限の近い順(期限なしは最後)。同じ期限は検査日の古い順。 */
export function compareFollowUpRows(a: FollowUpRow, b: FollowUpRow): number {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.date.localeCompare(b.date);
}

/** 期限が近いとみなす日数(ホームのカードと一覧の色分け)。 */
export const FOLLOW_UP_SOON_DAYS = 14;

// ---- 確認されないまま日数が経った検査結果 ----

/**
 * 未確認の結果として数える通知の種別(検索の `code`、カンマ区切りは OR)。緊急の通知
 * (緊急異常値・重要所見)が未確認の間は検査結果確認が出ないので、両方を数える。
 */
export const STALE_RESULT_TASK_CODES = [
  RESULT_REVIEW_TASK_CODE.code,
  LAB_PANIC_TASK_CODE.code,
  ...EXAM_REPORT_KINDS.map((config) => config.critical.taskCode.code),
]
  .map((code) => `${TASK_CODE_SYSTEM}|${code}`)
  .join(",");

/** 経過日数の選択肢。既定は 7 日。 */
export const STALE_RESULT_DAY_OPTIONS = [3, 7, 14, 30] as const;
export const DEFAULT_STALE_RESULT_DAYS = 7;
