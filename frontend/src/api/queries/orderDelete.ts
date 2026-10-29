import type { QueryClient } from "@tanstack/react-query";
import { postBundle } from "../fhirClient";
import { resourcesOfType, searchAllPages, WORKLIST_PAGE } from "./core";
import { rxVerificationDeleteEntries } from "./rxVerification";

// オーダー削除の後片付け(全種別共通)。
//
// オーダーを指しているリソースのうち、
//   - 進捗・通知の Task(focus / basedOn がオーダー)と調剤・払出の記録(MedicationDispense)は
//     オーダーと一緒に消す。オーダーが無くなれば意味を失い、残すと一覧や通知に孤児が出る。
//     連日の注射の監査 Task だけは、束ねに残る日があればその日へ付け替える(束ねに 1 件のため)。
//   - 実施記録(Procedure / MedicationAdministration)と結果(DiagnosticReport / Observation)は
//     診療の記録なので消さず、付いているオーダーは削除させない。実施の取消・結果の削除が先。
//     ただし Bundle 自身が同じ transaction で消す実施記録は数えない(登録と同時に実施済にする
//     指導・管理料は、オーダーと実施記録を一緒に消す)。
// ラベル発行済みの Specimen は発行・到着の記録として残す(結果の削除と同じ扱い)。

const DEPENDENT_MAX_PAGES = 4;

const SERVICE_REQUEST_DELETE = /^ServiceRequest\/([^/?]+)$/;

function deletedUrls(bundle: fhir4.Bundle): string[] {
  return (bundle.entry ?? [])
    .filter((entry) => entry.request?.method === "DELETE")
    .map((entry) => entry.request?.url ?? "");
}

function idsOf(resources: fhir4.Resource[]): string[] {
  return [...new Set(resources.map((r) => r.id).filter((id): id is string => Boolean(id)))];
}

/**
 * オーダーの削除 Bundle を送る。Bundle が消す ServiceRequest(ヘッダ・明細)を指すものを
 * 引き直し、実施記録・結果があれば throw し、Task と MedicationDispense の削除を同じ
 * transaction に足す。
 */
export async function postOrderDeleteBundle(bundle: fhir4.Bundle) {
  const urls = deletedUrls(bundle);
  const orderIds = urls
    .map((url) => url.match(SERVICE_REQUEST_DELETE)?.[1])
    .filter((id): id is string => Boolean(id));
  if (orderIds.length === 0) return postBundle(bundle);

  const orderParams = new URLSearchParams();
  orderParams.set("_id", orderIds.join(","));
  for (const target of [
    "Task:focus",
    "Task:based-on",
    "Procedure:based-on",
    "DiagnosticReport:based-on",
    "Observation:based-on",
  ]) {
    orderParams.append("_revinclude", target);
  }
  // 処方・注射の薬剤明細(MedicationRequest)。実施と調剤・払出はこちらを指す。
  const medicationParams = new URLSearchParams();
  medicationParams.set("based-on", orderIds.map((id) => `ServiceRequest/${id}`).join(","));
  medicationParams.append("_revinclude", "MedicationAdministration:request");
  medicationParams.append("_revinclude", "MedicationDispense:prescription");
  const options = { page: WORKLIST_PAGE, maxPages: DEPENDENT_MAX_PAGES, complete: true };
  const [orders, medications] = await Promise.all([
    searchAllPages<fhir4.ServiceRequest>("ServiceRequest", orderParams, options),
    searchAllPages<fhir4.MedicationRequest>("MedicationRequest", medicationParams, options),
  ]);
  const dependents = [...orders.bundles, ...medications.bundles];
  const ofType = <T extends fhir4.Resource>(type: T["resourceType"]) =>
    dependents.flatMap((b) => resourcesOfType<T>(b, type));

  const alreadyDeleted = new Set(urls);
  const remaining = <T extends fhir4.Resource>(type: T["resourceType"]) =>
    ofType<T>(type).filter((r) => !alreadyDeleted.has(`${type}/${r.id}`));

  if (remaining("Procedure").length > 0 || remaining("MedicationAdministration").length > 0) {
    throw new Error("実施記録があるため削除できません。実施を取り消してから削除してください。");
  }
  if (ofType("DiagnosticReport").length > 0 || ofType("Observation").length > 0) {
    throw new Error("結果があるため削除できません。結果を削除してから削除してください。");
  }

  // 連日の注射の監査 Task は、束ねに残る日があれば消さずに付け替える。
  const refocus = await rxVerificationDeleteEntries(ofType<fhir4.Task>("Task"), orderIds);
  const extra = [
    ...idsOf(ofType<fhir4.Task>("Task"))
      .filter((id) => !refocus.keptTaskIds.has(id))
      .map((id) => `Task/${id}`),
    ...idsOf(ofType<fhir4.MedicationDispense>("MedicationDispense")).map((id) => `MedicationDispense/${id}`),
  ]
    .filter((url) => !alreadyDeleted.has(url))
    .map((url) => ({ request: { method: "DELETE" as const, url } }));
  return postBundle({ ...bundle, entry: [...(bundle.entry ?? []), ...extra, ...refocus.entries] });
}

/** オーダー削除で一緒に消えた Task(通知を含む)・調剤記録を読み直させる。 */
export function invalidateOrderDependents(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["Task"] });
  queryClient.invalidateQueries({ queryKey: ["MedicationDispense"] });
}
