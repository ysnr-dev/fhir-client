import type { QueryClient } from "@tanstack/react-query";
import {
  buildActivityProvenanceEntry,
  buildOrderProvenanceEntry,
  type OrderActivity,
  type OrderEnterer,
} from "../../fhir/provenanceHelpers";
import { practitionerDisplayName } from "../../fhir/practitionerHelpers";
import { useCurrentPractitioner } from "../authQueries";
import { approvalOrdersOfBundle, buildOrderApprovalTaskEntry } from "../../fhir/orderApprovalTaskHelpers";
import { NOTIFICATION_TASK_KEY } from "./core";

/**
 * ログイン中の医療従事者。オーダーの来歴(Provenance)に入力者・承認者として名乗る相手。
 * Practitioner に紐付かないアカウント(管理者)では名乗れないので null(検体到着の記録者と
 * 同じ扱い)。
 */
export function useOrderEnterer(): OrderEnterer | null {
  const { practitionerId, practitioner } = useCurrentPractitioner();
  return practitionerId && practitioner
    ? { practitionerId, display: practitionerDisplayName(practitioner) }
    : null;
}

/**
 * オーダーの登録・編集 Bundle に「誰が入力したか」の Provenance を 1 件足す。
 *
 * 代行入力(医師以外のログインが指示医師を選んで入力する)を残すには、オーダー本体に入る
 * requester(= 指示医師)とは別にログイン中の本人を記録する必要があるが、resource を組み立てる
 * fhir/*.ts は React 非依存でログインユーザーを見られない。そこで登録(useCreatePrescription)と
 * 各種別の更新フックが、組み立て済みの Bundle をこれに通してから POST する
 * (postBundle はマスタ・予約枠まで通るので、そこに仕込むのは広すぎる)。
 */
export function useWithOrderProvenance(): (bundle: fhir4.Bundle) => fhir4.Bundle {
  const enterer = useOrderEnterer();
  return (bundle) => {
    const entry = enterer ? buildOrderProvenanceEntry(bundle, enterer) : null;
    if (!entry || !enterer) return bundle;
    // 代行入力なら指示医師あての承認待ちの通知も同じ transaction で作る
    // (来歴は urn:uuid で参照する。上流が採番済みの id に解決する)。
    const task = buildOrderApprovalTaskEntry(entry, approvalOrdersOfBundle(bundle), enterer);
    return { ...bundle, entry: [...(bundle.entry ?? []), entry, ...(task ? [task] : [])] };
  };
}

/**
 * 進捗・状態だけを変える活動(中止・完了・休止・再開)の来歴を作る。対象のオーダーと
 * 指示医師は呼ぶ側が渡す(Bundle には Task やヘッダの状態しか入らないため)。
 */
export function useActivityProvenance(): (
  orders: fhir4.ServiceRequest[],
  activity: OrderActivity,
) => fhir4.BundleEntry[] {
  const enterer = useOrderEnterer();
  return (orders, activity) => {
    const entry = enterer ? buildActivityProvenanceEntry(orders, activity, enterer) : null;
    if (!entry || !enterer) return [];
    const task = buildOrderApprovalTaskEntry(
      entry,
      orders.map((order) => ({ order, reference: `ServiceRequest/${order.id}` })),
      enterer,
    );
    return task ? [entry, task] : [entry];
  };
}

/**
 * 来歴を書いた・承認したあとに、詳細の来歴と通知(承認待ち)を読み直させる。
 * 登録・編集で承認待ちの通知が増えるので、来歴を書く 16 種別ぶんの onSuccess を
 * 触らずに済むようここで両方を無効化する。
 */
export function invalidateProvenance(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["Provenance"] });
  queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
}
