import {
  buildCompletedNotificationTask,
  completeNotificationEntry,
} from "../fhir/notificationHelpers";
import { ORDER_APPROVAL_TASK_CODE } from "../fhir/orderApprovalTaskHelpers";
import {
  approvalBundleEntry,
  buildApprovedProvenance,
  isVerifiedProvenance,
  type OrderEnterer,
} from "../fhir/provenanceHelpers";
import { TASK_CODE_SYSTEM } from "../fhir/taskHelpers";
import { searchResource } from "./fhirClient";

// 承認の transaction を組み立てる。承認待ち一覧(通知)とオーダー詳細モーダルの
// どちらからでも同じ結果になるよう、1 か所に置く。React には依存しない。

export const APPROVAL_NOTE_TEXT = "代行入力を承認しました。";

/** その来歴あての承認待ち通知。id を渡して引く(複数まとめて 1 回)。 */
async function fetchApprovalTasks(provenanceIds: string[]): Promise<fhir4.Task[]> {
  if (provenanceIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set("focus", provenanceIds.map((id) => `Provenance/${id}`).join(","));
  params.set("code", `${TASK_CODE_SYSTEM}|${ORDER_APPROVAL_TASK_CODE.code}`);
  params.set("status", "requested");
  params.set("_count", "100");
  const { data } = await searchResource<fhir4.Task>("Task", params);
  return (data.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is fhir4.Task => resource?.resourceType === "Task");
}

/** 承認する来歴。渡された id の最新を読む(一覧が古いまま上書きしないように)。 */
async function fetchProvenances(provenanceIds: string[]): Promise<fhir4.Provenance[]> {
  if (provenanceIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set("_id", provenanceIds.join(","));
  params.set("_count", "100");
  const { data } = await searchResource<fhir4.Provenance>("Provenance", params);
  return (data.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is fhir4.Provenance => resource?.resourceType === "Provenance");
}

/**
 * 承認の transaction entry。来歴に verifier と署名を足し、その来歴あての通知を対応済みにする。
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
      completeNotificationEntry(buildCompletedNotificationTask(task, actor, APPROVAL_NOTE_TEXT)),
    );
  }

  return entries;
}
