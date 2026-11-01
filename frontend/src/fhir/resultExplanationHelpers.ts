import { diffDays, localDay, nowFhirDateTime, today } from "../lib/dates";
import {
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
import { REVIEW_REPORT_KIND_LABEL, type ReviewReportKind } from "./resultReviewHelpers";

// 検査結果の患者説明の台帳(JAHIS 医療情報システムの患者安全ガイド 病理編 7.5.3)。
//
//   DiagnosticReport(検査結果) ← focus ── Task(患者説明) ── owner → 依頼医
//                                           └ output → 対応区分・説明日
//
// 検査結果確認(result-review)が「医師が読んだか」を追うのに対し、こちらは「患者に伝えたか」を追う。
// 結果を読んだまま患者への説明や次の対応が漏れる事故を防ぐため、確定したレポートごとに依頼医あての
// 台帳を作り、説明を記録するまで残す。依頼医だけでなく、チームの医師・看護師や医療安全の担当が
// 一覧(検査結果フォロー)で未説明を確かめられる。
//
// 説明は外来の次回受診まで数週間かかることが多いので、通知一覧(ベル)には載せない
// (フォロー推奨と同じ。通知レジストリに登録しない)。いまの対象は病理診断レポートだけ。

export const RESULT_EXPLANATION_TASK_CODE = { code: "result-explanation", display: "患者説明" };

export const RESULT_EXPLANATION_NOTE = "患者への説明を記録しました。";

const RESOLUTION_SYSTEM = "http://fhir-client.local/CodeSystem/result-explanation-resolution";

export const EXPLANATION_RESOLUTIONS = [
  { code: "explained", display: "説明済" },
  { code: "referred", display: "紹介先で説明" },
  { code: "not-needed", display: "説明不要" },
] as const;

export type ExplanationResolution = (typeof EXPLANATION_RESOLUTIONS)[number]["code"];

export function explanationResolutionDisplay(code: string | undefined): string {
  return EXPLANATION_RESOLUTIONS.find((r) => r.code === code)?.display ?? "";
}

/** 説明日を記録する対応区分か(説明不要には日付が無い)。 */
export function resolutionHasDate(code: ExplanationResolution): boolean {
  return code !== "not-needed";
}

/** 未説明のまま経つと目立たせる日数(一覧の色分けとホームのカード)。 */
export const EXPLANATION_OVERDUE_DAYS = 14;

// 一覧に出す内容は Task.input に持つ(上流の `_include=Task:focus` は ServiceRequest しか返さない)。
const KIND_INPUT = "種別";
const DATE_INPUT = "対象日";
const SUMMARY_INPUT = "内容";
const IMPORTANCE_INPUT = "重要度";
const STATUS_INPUT = "報告区分";
const RESOLUTION_OUTPUT = "対応";
const EXPLAINED_ON_OUTPUT = "説明日";

export interface ResultExplanationTaskInput {
  /** 焦点。同じ transaction で作るレポートは urn:uuid、更新は DiagnosticReport/{id}。 */
  reportReference: string;
  patientId: string;
  /** 宛先(依頼医)。オーダーに紐付かないレポートでは決まらない。 */
  owner?: fhir4.Reference;
  kind: ReviewReportKind;
  /** 対象日(報告日)。 */
  date: string;
  summary: string;
  /** 重要度の表示名(「悪性」など)。無ければ空。 */
  importance: string;
  /** 訂正・追加報告の表示名。最終報告なら空。 */
  statusLabel: string;
  basedOn?: fhir4.Reference[];
}

function buildResultExplanationTask(
  input: ResultExplanationTaskInput,
  existing?: fhir4.Task,
): fhir4.Task {
  const task = buildNotificationTask(
    {
      code: RESULT_EXPLANATION_TASK_CODE,
      severity: input.importance ? "caution" : "info",
      focusReference: input.reportReference,
      patientId: input.patientId,
      owner: input.owner,
      basedOn: input.basedOn,
      description: [
        REVIEW_REPORT_KIND_LABEL[input.kind],
        input.date,
        input.importance,
        input.statusLabel,
        input.summary,
      ]
        .filter(Boolean)
        .join(" "),
      input: [
        { type: { text: KIND_INPUT }, valueString: input.kind },
        { type: { text: DATE_INPUT }, valueDate: input.date },
        { type: { text: SUMMARY_INPUT }, valueString: input.summary },
        ...(input.importance ? [{ type: { text: IMPORTANCE_INPUT }, valueString: input.importance }] : []),
        ...(input.statusLabel ? [{ type: { text: STATUS_INPUT }, valueString: input.statusLabel }] : []),
      ],
    },
    existing,
  );
  // 内容が変わったので説明もやり直してもらう。前の説明の記録は Task の版の履歴に残る。
  delete task.output;
  return task;
}

/**
 * レポート保存の transaction に足す entry。確定(最終・訂正・追加報告)したときに台帳へ載せ、
 * 確定後に直したときは説明済みでも未説明に戻す(診断が変われば患者への説明も変わるため)。
 * 中間報告のうちは作らない。
 */
export function resultExplanationEntries(
  input: ResultExplanationTaskInput,
  reviewable: boolean,
  existing: fhir4.Task | undefined,
): fhir4.BundleEntry[] {
  if (!reviewable) return [];
  return [notificationTaskEntry(buildResultExplanationTask(input, existing), existing?.id)];
}

export interface ExplanationRecordInput {
  resolution: ExplanationResolution;
  /** 説明日(YYYY-MM-DD)。説明不要なら空。 */
  explainedOn: string;
  memo: string;
}

/** 説明を記録した Task。誰がいつ記録したかは note、何をしたかは output に持つ。 */
export function recordExplanationEntry(
  task: fhir4.Task,
  actor: { practitionerId: string; display: string },
  input: ExplanationRecordInput,
): fhir4.BundleEntry {
  const completed = buildCompletedNotificationTask(task, actor, input.memo.trim() || RESULT_EXPLANATION_NOTE);
  const display = explanationResolutionDisplay(input.resolution);
  completed.output = [
    {
      type: { text: RESOLUTION_OUTPUT },
      valueCodeableConcept: {
        coding: [{ system: RESOLUTION_SYSTEM, code: input.resolution, display }],
        text: display,
      },
    },
    ...(resolutionHasDate(input.resolution) && input.explainedOn
      ? [{ type: { text: EXPLAINED_ON_OUTPUT }, valueDate: input.explainedOn }]
      : []),
  ];
  return completeNotificationEntry(completed);
}

/** 記録を取り消して未説明に戻す(記録の誤りを直すため)。 */
export function reopenExplanationEntry(task: fhir4.Task): fhir4.BundleEntry {
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

export interface ExplanationRow extends NotificationRowBase {
  reportId: string;
  kind: ReviewReportKind;
  date: string;
  summary: string;
  importance: string;
  statusLabel: string;
  /** 台帳に載った(訂正・追加で載せ直した)日。 */
  issuedOn: string;
  /** 台帳に載ってからの日数。 */
  daysSince: number;
  status: fhir4.Task["status"];
  resolution: string;
  explainedOn: string;
  recordedBy: string;
  recordedOn: string;
  memo: string;
}

/**
 * 台帳に載った時刻。訂正・追加で載せ直すと lastModified が新しくなる(authoredOn は最初のまま)ので、
 * 未説明の行はこちらを経過日数の起点にする。
 */
function issuedAt(task: fhir4.Task): string {
  if (task.status === "requested") return task.lastModified ?? task.authoredOn ?? "";
  return task.executionPeriod?.start ?? task.authoredOn ?? "";
}

export function explanationRowOf(task: fhir4.Task, patient: fhir4.Patient | undefined): ExplanationRow {
  const resolution = (task.output ?? []).find((o) => o.type?.text === RESOLUTION_OUTPUT);
  const explainedOn = (task.output ?? []).find((o) => o.type?.text === EXPLAINED_ON_OUTPUT)?.valueDate;
  const note = task.note?.[0];
  const issuedOn = localDay(issuedAt(task));
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    reportId: task.focus?.reference?.match(/^DiagnosticReport\/(.+)$/)?.[1] ?? "",
    kind: (taskInputOf(task, KIND_INPUT)?.valueString ?? "patho") as ReviewReportKind,
    date: taskInputOf(task, DATE_INPUT)?.valueDate ?? "",
    summary: taskInputOf(task, SUMMARY_INPUT)?.valueString ?? "",
    importance: taskInputOf(task, IMPORTANCE_INPUT)?.valueString ?? "",
    statusLabel: taskInputOf(task, STATUS_INPUT)?.valueString ?? "",
    issuedOn,
    daysSince: issuedOn ? diffDays(issuedOn, today()) : 0,
    status: task.status,
    resolution: resolution?.valueCodeableConcept?.text ?? "",
    explainedOn: explainedOn ?? "",
    recordedBy: note?.authorReference?.display ?? "",
    recordedOn: localDay(note?.time ?? ""),
    memo: note?.text && note.text !== RESULT_EXPLANATION_NOTE ? note.text : "",
  };
}
