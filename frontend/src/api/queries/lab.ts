import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildLabOrderDeleteBundle, isLabServiceRequest, LAB_ORDER_TYPE, labOrderItemRequests } from "../../fhir/labOrderHelpers";
import { labelSpecimensByOrderId } from "../../fhir/labSpecimenHelpers";
import { buildLabTaskUpdate, labTasksByOrderId, type LabTaskStatus } from "../../fhir/labTaskHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/prescriptionHelpers";
import {
  comparePatientNumber,
  deleteOrderWithItems,
  fetchWorklistBundles,
  makeUpdateTaskStatusHook,
  worklistParams,
} from "./worklist";

// ---- 検体検査一覧(部門ワークリスト) ----
//
// 検査日(検体を採る日)で 1 日ぶんの検体検査オーダーを読む。作りは放射線検査一覧と
// 同じで、検体・入外区分・診療科での絞り込みは画面側で行う(理由は
// api/queries/rad.ts の「放射線検査一覧」の節)。
//
// 検査日は ServiceRequest.occurrenceDateTime(実施予定日時)で引く。

/** 検体検査一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface LabWorklistRow {
  order: fhir4.ServiceRequest;
  /** 検査項目(明細)。パネルの構成項目まで含む平坦な一覧。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** 管(ラベル発行が作った Specimen)。発行・到着の状況表示に使う。 */
  specimens: fhir4.Specimen[];
  /** このオーダーを元に登録済みの検査結果の id。空なら結果はまだ無い。 */
  reportId: string;
}

export interface LabWorklistResult {
  rows: LabWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchLabWorklist(date: string): Promise<LabWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];
  const specimens: fhir4.Specimen[] = [];
  // オーダー id → そのオーダーを元にした検査結果の id(結果登録が済んだかの判定用)。
  const reportIdByOrderId = new Map<string, string>();

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${LAB_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 検査項目・管(発行済み Specimen)・検査結果も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "Specimen:request");
      params.append("_revinclude", "DiagnosticReport:based-on");
      return params;
    },
    (resource) => {
      if (resource.resourceType === "Specimen") {
        specimens.push(resource as fhir4.Specimen);
      } else if (resource.resourceType === "DiagnosticReport") {
        const report = resource as fhir4.DiagnosticReport;
        for (const reference of report.basedOn ?? []) {
          const orderId = reference.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
          if (orderId && report.id) reportIdByOrderId.set(orderId, report.id);
        }
      } else if (resource.resourceType === "ServiceRequest") {
        const request = resource as fhir4.ServiceRequest;
        // 検索にヒットしたヘッダと、添えられた明細を分ける。
        if (isLabServiceRequest(request) && !request.basedOn?.length) {
          orders.push(request);
          return true;
        }
        items.push(request);
      }
      return false;
    },
  );

  const labTaskByOrderId = labTasksByOrderId(tasks);
  const specimensByOrderId = labelSpecimensByOrderId(specimens);

  const rows = orders.map((order) => ({
    order,
    itemRequests: labOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: labTaskByOrderId.get(order.id ?? ""),
    specimens: specimensByOrderId.get(order.id ?? "") ?? [],
    reportId: reportIdByOrderId.get(order.id ?? "") ?? "",
  }));

  // 検体検査オーダーは時刻を持たない(検査日だけ)ので、患者番号順に並べる。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** 検査日 1 日ぶんの検体検査オーダー。日付が未選択の間は読みに行かない。 */
export function useLabWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "lab-worklist", date],
    queryFn: () => fetchLabWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/** 受付などの進捗を書き込む(組み立ては makeUpdateTaskStatusHook を参照)。 */
export const useUpdateLabTaskStatus = makeUpdateTaskStatusHook<LabTaskStatus>(
  buildLabTaskUpdate,
  "lab-worklist",
);

/**
 * 検体検査は明細も ServiceRequest なので、ぶら下がっているものを引いてからヘッダごと消す
 * (処方の MedicationRequest と同じ考え方)。useDeleteLabOrder の本体(読み直しの指示を
 * 伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteLabOrderRequest = (srId: string) =>
  deleteOrderWithItems(srId, {
    itemsOf: labOrderItemRequests,
    build: ({ srId, itemIds }) => buildLabOrderDeleteBundle(srId, itemIds),
  });

export function useDeleteLabOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteLabOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}
