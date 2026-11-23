import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildLabOrderDeleteBundle, isLabServiceRequest, LAB_ORDER_TYPE, labOrderItemRequests } from "../../fhir/labOrderHelpers";
import {
  buildSpecimenShipment,
  buildSpecimenShipmentCancel,
  labelSpecimensByOrderId,
  type ArrivalRecorder,
  type LabLabelScope,
} from "../../fhir/labSpecimenHelpers";
import {
  buildLabTaskUpdate,
  labTaskStatus,
  labTasksByOrderId,
  type LabTaskStatus,
} from "../../fhir/labTaskHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { postBundle } from "../fhirClient";
import { postLabLabelsPdf } from "../reportsClient";
import {
  comparePatientNumber,
  deleteOrderWithItems,
  fetchWorklistBundles,
  makeUpdateTaskStatusHook,
  taskBundleEntry,
  worklistParams,
} from "./worklist";
import { invalidateOrderDependents } from "./orderDelete";

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
  /** その検査結果の項目(Observation)。外注検査の一覧だけが読む(検体検査一覧では空)。 */
  observations: fhir4.Observation[];
}

export interface LabWorklistResult {
  rows: LabWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

const LAB_ORDER_CATEGORY = `${ORDER_TYPE_SYSTEM}|${LAB_ORDER_TYPE.code}`;

// 検体検査オーダーのヘッダ検索を、行(オーダー 1 件 + 明細・管・進捗・結果)に組む。
// buildParams はヘッダを絞る条件だけを決め、添えてもらうリソースはここで足す。
// withObservations なら検査結果の項目(Observation)も添えてもらう(外注の管ごとに結果が
// 着いたかを見るため)。
async function fetchLabRows(
  buildParams: (page: number) => URLSearchParams,
  { withObservations = false }: { withObservations?: boolean } = {},
): Promise<LabWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];
  const specimens: fhir4.Specimen[] = [];
  const observationsById = new Map<string, fhir4.Observation>();
  // オーダー id → そのオーダーを元にした検査結果(結果登録が済んだかの判定用)。
  const reportByOrderId = new Map<string, fhir4.DiagnosticReport>();

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = buildParams(page);
      // 検査項目・管(発行済み Specimen)・検査結果も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "Specimen:request");
      params.append("_revinclude", "DiagnosticReport:based-on");
      if (withObservations) params.append("_include:iterate", "DiagnosticReport:result");
      return params;
    },
    (resource) => {
      if (resource.resourceType === "Observation") {
        if (resource.id) observationsById.set(resource.id, resource as fhir4.Observation);
      } else if (resource.resourceType === "Specimen") {
        specimens.push(resource as fhir4.Specimen);
      } else if (resource.resourceType === "DiagnosticReport") {
        const report = resource as fhir4.DiagnosticReport;
        for (const reference of report.basedOn ?? []) {
          const orderId = reference.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
          if (orderId && report.id) reportByOrderId.set(orderId, report);
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
    reportId: reportByOrderId.get(order.id ?? "")?.id ?? "",
    observations: (reportByOrderId.get(order.id ?? "")?.result ?? []).flatMap((reference) => {
      const observation = observationsById.get(reference.reference?.split("/").pop() ?? "");
      return observation ? [observation] : [];
    }),
  }));

  // 検体検査オーダーは時刻を持たない(検査日だけ)ので、患者番号順に並べる。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

function fetchLabWorklist(date: string): Promise<LabWorklistResult> {
  return fetchLabRows((page) => worklistParams(LAB_ORDER_CATEGORY, date, page, "occurrence"));
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

// ---- 外注検査(docs/lab-outsource-design.md §7) ----
//
// 外注先を performer に持つオーダー(ヘッダに明細の外注先を写してある)を、検査日の期間で読む。
// 提出は管の Specimen に書くが、上流は Specimen の拡張で引けないので、提出待ち・
// 結果未着の振り分けは読んだ後に画面側で行う。

export interface LabOutsourceWorklistQuery {
  /** 外注先(Organization.id)。複数ならどれかに出すオーダー。空なら読まない。 */
  organizationIds: string[];
  /** 検査日の期間(両端を含む)。 */
  from: string;
  to: string;
}

function fetchLabOutsourceWorklist({
  organizationIds,
  from,
  to,
}: LabOutsourceWorklistQuery): Promise<LabWorklistResult> {
  return fetchLabRows((page) => {
    const params = worklistParams(LAB_ORDER_CATEGORY, from, page, "occurrence");
    params.set("occurrence", `ge${from}`);
    params.append("occurrence", `le${to}`);
    params.set("performer", organizationIds.join(","));
    return params;
  }, { withObservations: true });
}

export function useLabOutsourceWorklist(query: LabOutsourceWorklistQuery) {
  return useQuery({
    queryKey: ["ServiceRequest", "lab-outsource", query],
    queryFn: () => fetchLabOutsourceWorklist(query),
    enabled: query.organizationIds.length > 0 && Boolean(query.from && query.to),
    placeholderData: keepPreviousData,
  });
}

/** 外注の管の提出をまとめて記録する(cancel なら取り消す)。1 つの transaction で書く。 */
export function useUpdateLabShipment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      specimens,
      cancel,
      recorder,
    }: {
      specimens: fhir4.Specimen[];
      cancel?: boolean;
      recorder?: ArrivalRecorder;
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: specimens.map((specimen) => ({
          resource: cancel
            ? buildSpecimenShipmentCancel(specimen)
            : buildSpecimenShipment(specimen, recorder),
          request: { method: "PUT" as const, url: `Specimen/${specimen.id}` },
        })),
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "lab-outsource"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "lab-worklist"] });
    },
  });
}

/**
 * 複数オーダーの検体ラベルをまとめて発行し、PDF を返す。行の「ラベル発行」と同じく発行が
 * 受付を兼ねるので、依頼済のオーダーを 1 つの transaction で受付済へ進める。
 * Specimen は PDF の生成で作られるので、失敗しても一覧は読み直す。
 */
export function useIssueLabLabels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rows, scope }: { rows: LabWorklistRow[]; scope: LabLabelScope }) => {
      const pdf = await postLabLabelsPdf(rows.map((row) => row.order.id ?? ""), scope);
      const requested = rows.filter((row) => labTaskStatus(row.task) === "requested");
      if (requested.length > 0) {
        await postBundle({
          resourceType: "Bundle",
          type: "transaction",
          entry: requested.map((row) =>
            taskBundleEntry(buildLabTaskUpdate(row.task, row.order, "accepted")),
          ),
        });
      }
      return pdf;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "lab-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

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
      invalidateOrderDependents(queryClient);
    },
  });
}
