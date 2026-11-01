import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { observationIdsFromReport, specimenIdsFromReport } from "../../fhir/labResultHelpers";
import {
  buildPathoOrderDeleteBundle,
  isPathoServiceRequest,
  PATHO_ORDER_TYPE,
  pathoOrderItemRequests,
  pathoOrderLabel,
  pathoOrderResponseIds,
} from "../../fhir/pathoOrderHelpers";
import {
  buildPathoResultDeleteBundle,
  isRevisedReportStatus,
  pathoReportImportance,
  pathoReportResponseIds,
  reportImportanceDisplay,
  reportStatusDisplay,
} from "../../fhir/pathoResultHelpers";
import { buildCancelledNotificationTask, notificationTaskEntry } from "../../fhir/notificationHelpers";
import {
  isReviewableReportStatus,
  RESULT_REVIEW_TASK_CODE,
  resultReviewTaskEntries,
} from "../../fhir/resultReviewHelpers";
import {
  RESULT_EXPLANATION_TASK_CODE,
  resultExplanationEntries,
} from "../../fhir/resultExplanationHelpers";
import { buildPathoTaskUpdate, pathoTasksByOrderId, type PathoTaskStatus } from "../../fhir/pathoTaskHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { postBundle, readResource } from "../fhirClient";
import { makeOrderDetailHook, NOTIFICATION_TASK_KEY, ORDER_ITEM_REVINCLUDES } from "./core";
import {
  fetchOrderCandidates,
  type LabOrderCandidate,
  useLabResultDetail,
  useOrderCandidatesQuery,
  useResultSummariesQuery,
} from "./labResult";
import { pathoReviewSummary } from "./micro";
import { fetchOrderRequester, fetchReportTasks } from "./notification";
import {
  comparePatientNumber,
  deleteOrderWithItems,
  fetchWorklistBundles,
  makeUpdateTaskStatusHook,
  worklistParams,
} from "./worklist";
import { invalidateOrderDependents } from "./orderDelete";

// ---- 病理検査オーダー ----

// 病理オーダーもヘッダと検体明細が別リソースなので、検体検査・細菌検査と同じ形で
// 1 リクエストにまとめて取る。
export const usePathoOrderDetail = makeOrderDetailHook("patho-order", ORDER_ITEM_REVINCLUDES);

/**
 * テンプレートの記入内容も一緒に消す(オーダーが消えると誰も参照しなくなるため)。
 * useDeletePathoOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deletePathoOrderRequest = (srId: string) =>
  deleteOrderWithItems(srId, {
    itemsOf: pathoOrderItemRequests,
    build: ({ srId, itemIds, requests }) =>
      buildPathoOrderDeleteBundle(
        srId,
        itemIds,
        pathoOrderResponseIds(requests.filter((request) => request.id === srId)),
      ),
  });

export function useDeletePathoOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePathoOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      invalidateOrderDependents(queryClient);
    },
  });
}

// ---- 病理検査一覧(部門ワークリスト) ----
//
// 採取(予定)日で 1 日ぶんの病理検査オーダーを読む。画面の作りは検体検査一覧と同じで、
// 検査区分・入外区分・病棟・診療科・進捗での絞り込みは画面側で行う
// (理由は api/queries/rad.ts の「放射線検査一覧」の節)。

/** 病理検査一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface PathoWorklistRow {
  order: fhir4.ServiceRequest;
  /** 検体明細。臓器・検体タイプはここから組み立てる。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** このオーダーを元に登録済みの病理レポートの id。空ならレポートはまだ無い。 */
  reportId: string;
  /** レポートの報告区分(preliminary / final / amended)。 */
  reportStatus: string;
}

export interface PathoWorklistResult {
  rows: PathoWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchPathoWorklist(date: string): Promise<PathoWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];
  // オーダー id → そのオーダーを元にした病理レポート(id と報告区分)。
  const reportByOrderId = new Map<string, { id: string; status: string }>();

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${PATHO_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 検体明細・進捗・病理レポートも同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "DiagnosticReport:based-on");
      return params;
    },
    (resource) => {
      if (resource.resourceType === "DiagnosticReport") {
        const report = resource as fhir4.DiagnosticReport;
        for (const reference of report.basedOn ?? []) {
          const orderId = reference.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
          if (orderId && report.id) {
            reportByOrderId.set(orderId, { id: report.id, status: report.status });
          }
        }
      } else if (resource.resourceType === "ServiceRequest") {
        const request = resource as fhir4.ServiceRequest;
        // 検索にヒットしたヘッダと、添えられた明細を分ける。
        if (isPathoServiceRequest(request) && !request.basedOn?.length) {
          orders.push(request);
          return true;
        }
        items.push(request);
      }
      return false;
    },
  );

  const taskByOrderId = pathoTasksByOrderId(tasks);

  const rows = orders.map((order) => {
    const report = reportByOrderId.get(order.id ?? "");
    return {
      order,
      itemRequests: pathoOrderItemRequests(items, order.id ?? ""),
      patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
      task: taskByOrderId.get(order.id ?? ""),
      reportId: report?.id ?? "",
      reportStatus: report?.status ?? "",
    };
  });

  // 病理オーダーは採取時刻を持つこともあるが、日単位の一覧では患者番号順が扱いやすい。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** 採取(予定)日 1 日ぶんの病理検査オーダー。日付が未選択の間は読みに行かない。 */
export function usePathoWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "patho-worklist", date],
    queryFn: () => fetchPathoWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/** 受付などの進捗を書き込む(組み立ては makeUpdateTaskStatusHook を参照)。 */
export const useUpdatePathoTaskStatus = makeUpdateTaskStatusHook<PathoTaskStatus>(
  buildPathoTaskUpdate,
  "patho-worklist",
);

// ---- 病理診断レポート ----

function fetchPathoOrderCandidates(patientId: string): Promise<LabOrderCandidate[]> {
  return fetchOrderCandidates(patientId, PATHO_ORDER_TYPE.code, pathoOrderLabel);
}

/** 病理レポートに紐付ける病理検査オーダーの候補。 */
export function usePathoOrderCandidates(
  patientId: string | undefined,
  currentReportId?: string,
) {
  return useOrderCandidatesQuery(
    ["ServiceRequest", "search", "patho-order-candidates", patientId],
    fetchPathoOrderCandidates,
    patientId,
    currentReportId,
  );
}

/**
 * 病理タブの報告日ペイン用。組織診(SP)・細胞診(CP)の両方を新しい順で返す。
 * category はトークン検索なのでカンマ区切りで OR になる。
 */
export function usePathoResultEntries(patientId: string | undefined) {
  const query = useResultSummariesQuery("SP,CP", patientId);
  return {
    entries: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    truncated: query.truncated,
  };
}

// 内容表示・編集の取得は検体検査結果と同じ形(_id + result / specimen の _include)。
export function usePathoResultDetail(reportId: string | undefined) {
  return useLabResultDetail(reportId);
}

/**
 * レポート保存の Bundle に通知と台帳を足す。宛先(依頼医)と既存の 2 つはここで引く。
 *
 * - 検査結果確認: 確定(最終・訂正・追加報告)したとき。重要度(悪性・悪性疑い)があればアラートにし、
 *   重要度と訂正・追加の別を印として添える
 * - 患者説明: 確定したときに台帳へ載せる。確定後に直したら説明済みでも未説明に戻す
 */
async function withPathoReportTasks(bundle: fhir4.Bundle): Promise<fhir4.Bundle> {
  const entry = bundle.entry ?? [];
  const reportEntry = entry.find((e) => e.resource?.resourceType === "DiagnosticReport");
  const report = reportEntry?.resource as fhir4.DiagnosticReport | undefined;
  const reference = report?.id ? `DiagnosticReport/${report.id}` : reportEntry?.fullUrl;
  if (!report || !reference || !isReviewableReportStatus(report.status)) return bundle;

  const patientId = report.subject?.reference?.split("/").pop() ?? "";
  const orderReference = report.basedOn?.[0]?.reference;
  const orderId = orderReference?.split("/").pop();
  const [owner, tasks] = await Promise.all([
    orderId ? fetchOrderRequester(orderId) : Promise.resolve(undefined),
    report.id
      ? fetchReportTasks(report.id, [RESULT_REVIEW_TASK_CODE.code, RESULT_EXPLANATION_TASK_CODE.code])
      : Promise.resolve(new Map<string, fhir4.Task>()),
  ]);

  const date = report.effectiveDateTime?.slice(0, 10) ?? "";
  const summary = pathoReviewSummary(report);
  const basedOn = orderReference ? [{ reference: orderReference }] : undefined;
  const importance = reportImportanceDisplay(pathoReportImportance(report));
  const statusLabel = isRevisedReportStatus(report.status) ? reportStatusDisplay(report.status) : "";

  return {
    ...bundle,
    entry: [
      ...entry,
      ...resultReviewTaskEntries(
        {
          reportReference: reference,
          patientId,
          owner,
          kind: "patho",
          date,
          summary,
          basedOn,
          severity: importance ? "alert" : "info",
          flags: [importance, statusLabel].filter(Boolean),
        },
        true,
        tasks.get(RESULT_REVIEW_TASK_CODE.code),
      ),
      ...resultExplanationEntries(
        { reportReference: reference, patientId, owner, kind: "patho", date, summary, importance, statusLabel, basedOn },
        true,
        tasks.get(RESULT_EXPLANATION_TASK_CODE.code),
      ),
    ],
  };
}

// 病理レポートを保存・削除するとオーダーの紐付け状況が変わるため、
// 病理オーダーの候補(["ServiceRequest", "search"] 配下)も無効化する。
export function useCreatePathoResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bundle: fhir4.Bundle) => postBundle(await withPathoReportTasks(bundle)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "patho-worklist"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

export function useUpdatePathoResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bundle: fhir4.Bundle) => postBundle(await withPathoReportTasks(bundle)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "patho-worklist"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

/**
 * レポートの削除。所見・検体・テンプレート回答を消し、未確認の検査結果確認と未説明の患者説明を
 * 取り下げる(削除したレポートを指す通知・台帳が残らないようにする)。
 */
export function useDeletePathoResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: string) => {
      // 削除対象の Observation / Specimen は DiagnosticReport の参照から辿る。
      const [{ data: report }, tasks] = await Promise.all([
        readResource<fhir4.DiagnosticReport>("DiagnosticReport", reportId),
        fetchReportTasks(reportId, [RESULT_REVIEW_TASK_CODE.code, RESULT_EXPLANATION_TASK_CODE.code]),
      ]);
      const deleteBundle = buildPathoResultDeleteBundle(
        reportId,
        observationIdsFromReport(report),
        specimenIdsFromReport(report),
        pathoReportResponseIds([report]),
      );
      const cancelEntries = Array.from(tasks.values())
        .filter((task) => task.status === "requested")
        .map((task) => notificationTaskEntry(buildCancelledNotificationTask(task), task.id));
      return postBundle({ ...deleteBundle, entry: [...(deleteBundle.entry ?? []), ...cancelEntries] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "patho-worklist"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}
