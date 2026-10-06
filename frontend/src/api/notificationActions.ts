import {
  NOTE_COUNTERSIGN_NOTE,
  buildCountersignedNote,
  closeNoteCountersignEntries,
  countersignStateOf,
} from "../fhir/countersignHelpers";
import {
  buildCancelledNotificationTask,
  buildCompletedNotificationTask,
  completeNotificationEntry,
} from "../fhir/notificationHelpers";
import { ORDER_APPROVAL_TASK_CODE, isTraineeApprovalTask } from "../fhir/orderApprovalTaskHelpers";
import {
  approvalBundleEntry,
  buildApprovedProvenance,
  buildReviewProvenance,
  isVerifiedProvenance,
  reviewProvenanceEntry,
  type OrderEnterer,
} from "../fhir/provenanceHelpers";
import {
  RESULT_REVIEW_NOTE,
  RESULT_REVIEW_TASK_CODE,
  isReviewableReportStatus,
} from "../fhir/resultReviewHelpers";
import { TASK_CODE_SYSTEM } from "../fhir/taskHelpers";
import { searchResource } from "./fhirClient";
import { resourcesOfType } from "./queries/core";
import { fetchNoteTasks } from "./queries/countersign";

// 承認の transaction を組み立てる。承認待ち一覧(通知)とオーダー詳細モーダルの
// どちらからでも同じ結果になるよう、1 か所に置く。React には依存しない。

export const APPROVAL_NOTE_TEXT = "代行入力を承認しました。";
const TRAINEE_APPROVAL_NOTE_TEXT = "研修医のオーダーを承認しました。";

/** その来歴あての承認待ち通知。id を渡して引く(複数まとめて 1 回)。 */
async function fetchApprovalTasks(provenanceIds: string[]): Promise<fhir4.Task[]> {
  if (provenanceIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set("focus", provenanceIds.map((id) => `Provenance/${id}`).join(","));
  params.set("code", `${TASK_CODE_SYSTEM}|${ORDER_APPROVAL_TASK_CODE.code}`);
  params.set("status", "requested");
  params.set("_count", "100");
  const { data } = await searchResource<fhir4.Task>("Task", params);
  return resourcesOfType<fhir4.Task>(data, "Task");
}

/** 承認する来歴。渡された id の最新を読む(一覧が古いまま上書きしないように)。 */
async function fetchProvenances(provenanceIds: string[]): Promise<fhir4.Provenance[]> {
  if (provenanceIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set("_id", provenanceIds.join(","));
  params.set("_count", "100");
  const { data } = await searchResource<fhir4.Provenance>("Provenance", params);
  return resourcesOfType<fhir4.Provenance>(data, "Provenance");
}

/**
 * 承認の transaction entry。来歴に verifier と署名を足し、その来歴あての通知を閉じる
 * (自分あては対応済み、研修医の活動で他の指導医あてに並んでいたものは取り下げ)。
 *
 * 通知が見つからない来歴も承認は通す。通知を持たない時期の承認待ちが残っていても
 * 詳細モーダルから承認できるようにするため(readme「代行入力の記録と承認」)。
 */
export async function approvalTransactionEntries(
  provenanceIds: string[],
  actor: OrderEnterer,
): Promise<fhir4.BundleEntry[]> {
  const ids = Array.from(new Set(provenanceIds.filter(Boolean)));
  const [provenances, tasks] = await Promise.all([fetchProvenances(ids), fetchApprovalTasks(ids)]);

  const entries: fhir4.BundleEntry[] = provenances
    // 既に承認済みのものに署名を重ねない(別の端末で承認された後の取りこぼし)。
    .filter((provenance) => !isVerifiedProvenance(provenance))
    .map((provenance) => approvalBundleEntry(buildApprovedProvenance(provenance, actor)));

  for (const task of tasks) {
    entries.push(
      completeNotificationEntry(
        task.owner?.reference === `Practitioner/${actor.practitionerId}`
          ? buildCompletedNotificationTask(
              task,
              actor,
              isTraineeApprovalTask(task) ? TRAINEE_APPROVAL_NOTE_TEXT : APPROVAL_NOTE_TEXT,
            )
          : buildCancelledNotificationTask(task),
      ),
    );
  }

  return entries;
}

// ---- 研修医の診療記録のカウンターサイン ----

/** 承認する記録。id の最新を読む(一覧が古いまま上書きしないように)。 */
async function fetchCompositions(compositionIds: string[]): Promise<fhir4.Composition[]> {
  if (compositionIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set("_id", compositionIds.join(","));
  params.set("_count", "100");
  const { data } = await searchResource<fhir4.Composition>("Composition", params);
  return resourcesOfType<fhir4.Composition>(data, "Composition");
}

/**
 * 記録のカウンターサインの transaction entry。記録に指導医の署名(professional)を足して
 * PUT し(読んだ版を postBundle が ifMatch に添える)、承認待ちの通知を閉じる。
 * 既に承認済み・作成中に戻っている記録には署名を重ねない。
 */
export async function noteCountersignEntries(
  rows: { compositionId: string }[],
  actor: OrderEnterer,
): Promise<fhir4.BundleEntry[]> {
  const ids = Array.from(new Set(rows.map((row) => row.compositionId).filter(Boolean)));
  const [compositions, tasks] = await Promise.all([fetchCompositions(ids), fetchNoteTasks(ids)]);

  const entries: fhir4.BundleEntry[] = compositions
    .filter((composition) => countersignStateOf(composition, false) === "pending")
    .map((composition) => ({
      resource: buildCountersignedNote(composition, actor),
      request: { method: "PUT", url: `Composition/${composition.id}` },
    }));
  entries.push(...closeNoteCountersignEntries(tasks, actor, NOTE_COUNTERSIGN_NOTE));
  return entries;
}

// ---- 緊急の通知(緊急異常値・重要所見)の確認 ----

/**
 * 緊急の通知を確認する transaction entry。
 *
 * 緊急の通知が未確認の間は検査結果確認の通知を作らない(resultReviewHelpers の
 * urgentAwareReviewTaskEntries)ので、確認したときに結果そのものを読んだことも残す。
 * レポートが最終報告(訂正を含む)なら既読の来歴を書き、未確認の検査結果確認があれば
 * 対応済みにする。暫定報告のうちは既読を残さない(内容が変わりうるため)。
 */
export async function urgentConfirmationEntries(
  rows: { task: fhir4.Task; reportId: string }[],
  actor: OrderEnterer,
  noteText: string,
): Promise<fhir4.BundleEntry[]> {
  const reportIds = Array.from(new Set(rows.map((row) => row.reportId).filter(Boolean)));
  const [reports, reviewTasks] = await Promise.all([
    fetchReports(reportIds),
    fetchOpenReviewTasks(reportIds),
  ]);

  const entries: fhir4.BundleEntry[] = rows.map((row) =>
    completeNotificationEntry(buildCompletedNotificationTask(row.task, actor, noteText)),
  );

  for (const report of reports) {
    if (!report.id || !isReviewableReportStatus(report.status)) continue;
    const reference = `DiagnosticReport/${report.id}`;
    entries.push(reviewProvenanceEntry(buildReviewProvenance(reference, actor)));
    for (const task of reviewTasks.filter((t) => t.focus?.reference === reference)) {
      entries.push(
        completeNotificationEntry(buildCompletedNotificationTask(task, actor, RESULT_REVIEW_NOTE)),
      );
    }
  }
  return entries;
}

async function fetchReports(reportIds: string[]): Promise<fhir4.DiagnosticReport[]> {
  if (reportIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set("_id", reportIds.join(","));
  params.set("_count", "100");
  const { data } = await searchResource<fhir4.DiagnosticReport>("DiagnosticReport", params);
  return resourcesOfType<fhir4.DiagnosticReport>(data, "DiagnosticReport");
}

async function fetchOpenReviewTasks(reportIds: string[]): Promise<fhir4.Task[]> {
  if (reportIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set("focus", reportIds.map((id) => `DiagnosticReport/${id}`).join(","));
  params.set("code", `${TASK_CODE_SYSTEM}|${RESULT_REVIEW_TASK_CODE.code}`);
  params.set("status", "requested");
  params.set("_count", "100");
  const { data } = await searchResource<fhir4.Task>("Task", params);
  return resourcesOfType<fhir4.Task>(data, "Task");
}
