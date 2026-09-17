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

// 検査結果の確認(既読)の通知。
//
//   DiagnosticReport(検査結果) ← focus ── Task(通知) ── owner → 依頼医
//
// 「結果が出たことを医師が知り、読んだ」を残す。確認そのものの記録は Provenance
// (provenanceHelpers の buildReviewProvenance)が正本で、この Task は宛先と未確認・
// 確認済みだけを持つ(オーダー承認と同じ切り分け)。強度はお知らせで、緊急異常値
// (アラート)と同じ一覧に並んでも重さが混ざらない。
//
// 通知を作るのは**最終報告になったときだけ**。中間報告は値が変わりうるので読ませない。
// 訂正報告で出し直すときは同じ通知を書き換えて未確認に戻す。
//
// 同じ結果に緊急の通知(検体検査の緊急異常値・読影の重要所見)が未確認で出ている間は、
// この通知を作らない(urgentAwareReviewTaskEntries)。宛先が同じ依頼医で、2 回確認させる
// ことになるため。緊急の通知を確認するときに、最終報告なら既読の来歴も一緒に残す。

export const RESULT_REVIEW_TASK_CODE = { code: "result-review", display: "検査結果確認" };

/** 確認したときに通知へ残す文。一覧からの一括確認と、カルテの確認ボタンで共通。 */
export const RESULT_REVIEW_NOTE = "検査結果を確認しました。";

/**
 * 確認の対象になるレポートの種別。一覧の表示とカルテでの開き方がこれで決まる。
 * 検体検査・細菌・病理はカルテのタブのキーと同じ文字列にしてある。放射線(読影レポート)は
 * カルテにタブを持たないので、詳細モーダルで開く(notificationRegistry の karteLink)。
 */
export type ReviewReportKind = "lab" | "micro" | "patho" | "rad";

export const REVIEW_REPORT_KIND_LABEL: Record<ReviewReportKind, string> = {
  lab: "検体検査",
  micro: "細菌検査",
  patho: "病理検査",
  rad: "放射線検査",
};

// 一覧に出す内容は Task.input に構造化して持つ(上流の `_include=Task:focus` は
// ServiceRequest しか返さないので、レポート本体は読めない)。
const KIND_INPUT = "種別";
const DATE_INPUT = "対象日";
const SUMMARY_INPUT = "内容";

export function isResultReviewTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, RESULT_REVIEW_TASK_CODE.code);
}

export interface ResultReviewTaskInput {
  /** 焦点。同じ transaction 内で作るレポートは urn:uuid、更新は DiagnosticReport/{id}。 */
  reportReference: string;
  patientId: string;
  /** 宛先(依頼医)。オーダーに紐付かないレポートでは決まらないので任意。 */
  owner?: fhir4.Reference;
  kind: ReviewReportKind;
  /** 対象日(検体採取日・検査日)。 */
  date: string;
  /** 一覧の内容に出す 1 行の要約(検体名・部位・撮影内容など)。 */
  summary: string;
  /** 元になったオーダー。オーダー側から未確認を引けるようにする。 */
  basedOn?: fhir4.Reference[];
}

export function buildResultReviewTask(
  input: ResultReviewTaskInput,
  existing?: fhir4.Task,
): fhir4.Task {
  const kindLabel = REVIEW_REPORT_KIND_LABEL[input.kind];
  return buildNotificationTask(
    {
      code: RESULT_REVIEW_TASK_CODE,
      // 結果を読むのは診療の通常の仕事で、急がせる種類の通知ではない。
      severity: "info",
      focusReference: input.reportReference,
      patientId: input.patientId,
      owner: input.owner,
      basedOn: input.basedOn,
      description: [kindLabel, input.date, input.summary].filter(Boolean).join(" "),
      input: [
        { type: { text: KIND_INPUT }, valueString: input.kind },
        { type: { text: DATE_INPUT }, valueDate: input.date },
        { type: { text: SUMMARY_INPUT }, valueString: input.summary },
      ],
    },
    existing,
  );
}

/**
 * 結果保存の transaction に足す entry。`reviewable`(最終報告になったか)が false の
 * 間は何も作らない。既にある通知は、内容を更新して未確認に戻す。
 */
export function resultReviewTaskEntries(
  input: ResultReviewTaskInput,
  reviewable: boolean,
  existingTask?: fhir4.Task,
): fhir4.BundleEntry[] {
  if (!reviewable) return [];
  return [notificationTaskEntry(buildResultReviewTask(input, existingTask), existingTask?.id)];
}

/** 既読を記録できる報告区分か。中間報告(暫定報告)は値・所見が変わりうるので読ませない。 */
export function isReviewableReportStatus(status: string | undefined): boolean {
  return Boolean(status) && status !== "preliminary" && status !== "registered" && status !== "partial";
}

/**
 * 保存後に、緊急の通知(緊急異常値・重要所見)が未確認で残るか。
 * 同じ transaction で書く通知があればその状態、無ければ既存の通知の状態で決まる。
 */
export function urgentNotificationOpenAfter(
  urgentEntries: fhir4.BundleEntry[],
  existingUrgentTask: fhir4.Task | undefined,
): boolean {
  const written = urgentEntries
    .map((entry) => entry.resource)
    .find((resource): resource is fhir4.Task => resource?.resourceType === "Task");
  return (written ?? existingUrgentTask)?.status === "requested";
}

/**
 * 緊急の通知と並べるときの検査結果確認の entry。緊急の通知が未確認で残るなら作らず、
 * 未確認の検査結果確認があれば取り下げる(1 つの結果に通知を 1 件にする)。
 * 緊急の通知が無い・確認済みなら、通常どおり resultReviewTaskEntries に任せる。
 */
export function urgentAwareReviewTaskEntries(
  input: ResultReviewTaskInput,
  reviewable: boolean,
  existingReviewTask: fhir4.Task | undefined,
  urgentOpen: boolean,
): fhir4.BundleEntry[] {
  if (!urgentOpen) return resultReviewTaskEntries(input, reviewable, existingReviewTask);
  if (existingReviewTask?.status !== "requested") return [];
  return [
    notificationTaskEntry(buildCancelledNotificationTask(existingReviewTask), existingReviewTask.id),
  ];
}

export interface ResultReviewRow extends NotificationRowBase {
  /** レポートの id。カルテで開くのに使う。 */
  reportId: string;
  kind: ReviewReportKind;
  date: string;
  summary: string;
}

export function resultReviewRowOf(
  task: fhir4.Task,
  patient: fhir4.Patient | undefined,
): ResultReviewRow {
  const kind = (taskInputOf(task, KIND_INPUT)?.valueString ?? "lab") as ReviewReportKind;
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    reportId: task.focus?.reference?.split("/").pop() ?? "",
    kind,
    date: taskInputOf(task, DATE_INPUT)?.valueDate ?? "",
    summary: taskInputOf(task, SUMMARY_INPUT)?.valueString ?? "",
  };
}
