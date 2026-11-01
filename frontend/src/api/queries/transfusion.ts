import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildTransfusionOrderDeleteBundle,
  isTransfusionServiceRequest,
  TRANSFUSION_ORDER_TYPE,
  transfusionOrderItemRequests,
} from "../../fhir/transfusionOrderHelpers";
import {
  buildTransfusionTaskUpdate,
  transfusionTasksByOrderId,
  transfusionTaskStatus,
  type TransfusionTaskStatus,
} from "../../fhir/transfusionTaskHelpers";
import { buildTransfusionPerformDeleteEntries } from "../../fhir/transfusionResultHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { postBundle } from "../fhirClient";
import { makeOrderDetailHook, ORDER_ITEM_REVINCLUDES } from "./core";
import {
  cancelsPerform,
  comparePatientNumber,
  deleteOrderWithItems,
  fetchWorklistBundles,
  makePerformDetailHook,
  makeUpdateTaskStatusHook,
  performCancelEntries,
  worklistParams,
} from "./worklist";
import { invalidateOrderDependents } from "./orderDelete";

// ---- 輸血オーダー ----

// 輸血オーダーもヘッダと製剤明細が別リソースなので、病理・検体検査と同じ形で
// 1 リクエストにまとめて取る。
export const useTransfusionOrderDetail = makeOrderDetailHook("transfusion-order", ORDER_ITEM_REVINCLUDES);

/** useDeleteTransfusionOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。 */
export const deleteTransfusionOrderRequest = (srId: string) =>
  deleteOrderWithItems(srId, {
    itemsOf: transfusionOrderItemRequests,
    build: ({ srId, itemIds }) => buildTransfusionOrderDeleteBundle(srId, itemIds),
  });

export function useDeleteTransfusionOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTransfusionOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      invalidateOrderDependents(queryClient);
    },
  });
}

// ---- 輸血一覧(部門ワークリスト) ----
//
// 投与予定日で 1 日ぶんの輸血オーダーを読む。画面の作りは病理検査一覧と同じで、
// 輸血検査区分・製剤区分・入外区分・病棟・診療科・進捗での絞り込みは画面側で行う
// (理由は api/queries/rad.ts の「放射線検査一覧」の節)。
//
// 病理と違い DiagnosticReport は無い(輸血に結果レポートは無く、記録は実施記録側)。

/** 輸血一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface TransfusionWorklistRow {
  order: fhir4.ServiceRequest;
  /** 製剤明細。製剤名・単位数はここから組み立てる。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
}

export interface TransfusionWorklistResult {
  rows: TransfusionWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchTransfusionWorklist(date: string): Promise<TransfusionWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${TRANSFUSION_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 製剤明細と進捗も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.append("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      // 検索にヒットしたヘッダと、添えられた明細を分ける。
      if (isTransfusionServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = transfusionTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: transfusionOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  // 輸血オーダーは投与予定時刻を持つが、日単位の一覧では患者番号順が扱いやすい
  // (病理・検体検査と同じ)。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** 投与予定日 1 日ぶんの輸血オーダー。日付が未選択の間は読みに行かない。 */
export function useTransfusionWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "transfusion-worklist", date],
    queryFn: () => fetchTransfusionWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

// ---- 輸血の実施記録 ----

export const useTransfusionPerformDetail = makePerformDetailHook("transfusion-perform", { observations: true });

/**
 * 受付・出庫・中止などの進捗を書き込む。実施済から戻す(実施取消)ときは、実施記録も
 * 同じ transaction で消す(理由は transfusionResultHelpers の buildTransfusionPerformDeleteEntries を参照)。
 */
export const useUpdateTransfusionTaskStatus = makeUpdateTaskStatusHook<TransfusionTaskStatus>(
  buildTransfusionTaskUpdate,
  "transfusion-worklist",
  {
    cancelPerform: {
      cancels: cancelsPerform(transfusionTaskStatus),
      entries: (order) =>
        performCancelEntries(order.id ?? "", { observations: true }, buildTransfusionPerformDeleteEntries),
    },
    invalidate: invalidateTransfusion,
  },
);

/**
 * 輸血の実施登録。実施記録一式と Task の実施済を 1 つの transaction で書き込む。
 * Bundle の組み立ては transfusionResultHelpers を参照。
 */
export function useRegisterTransfusionPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateTransfusion(queryClient),
  });
}

/** 輸血の進捗・実施記録が動いたときに読み直させるもの。 */
function invalidateTransfusion(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "transfusion-worklist"] });
  // カルテのオーダーカードも進捗と実施情報を出しているので読み直させる。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  // 取消では実施記録も消しているので、FHIR JSON 表示の実施記録も引き直させる。
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
}
