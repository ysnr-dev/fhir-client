import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildRescheduleEntries } from "../../fhir/appointmentHelpers";
import { isExamReport, type ExamReportConfig } from "../../fhir/examReportHelpers";
import type { ExamTaskStatus } from "../../fhir/examTaskHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { postBundle } from "../fhirClient";
import { fetchAppointmentSlots, invalidateAppointments } from "./appointment";
import { makeOrderDetailHook, ORDER_ITEM_REVINCLUDES } from "./core";
import { assertNoExamReportForCancel, examReportDeleteGuard } from "./examReport";
import { invalidateOrderDependents } from "./orderDelete";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";
import type { RadBookingChange } from "./rad";
import {
  cancelsPerform,
  deleteOrderWithItems,
  fetchWorklistBundles,
  makePerformDetailHook,
  makeUpdateTaskStatusHook,
  performCancelEntries,
  worklistParams,
  type ExamWorklistResult,
  type ExamWorklistRow,
} from "./worklist";

// ---- 検査種別を軸に持つ部門(生理検査・内視鏡)のオーダー ----
//
// 放射線検査と同じ形。ヘッダと明細が別リソースなので 1 リクエストにまとめて取り、
// 部門一覧・実施記録・予約の扱いも放射線と同型にしている。違うのは実施記録に
// 被曝線量(Observation)がぶら下がらない点。部門の違いは FHIR の組み立て・判定の関数だけなので
// 設定で受け取る。

export interface ExamOrderQueriesConfig {
  /** `physio` など。クエリキー(`physio-order` / `physio-worklist` …)の元。 */
  dept: string;
  orderType: { code: string };
  reportConfig: ExamReportConfig;
  isServiceRequest: (request: fhir4.ServiceRequest) => boolean;
  itemRequestsOf: (requests: fhir4.ServiceRequest[], orderId: string) => fhir4.ServiceRequest[];
  responseIdsOf: (itemRequests: fhir4.ServiceRequest[]) => string[];
  /** 実施時刻("HH:MM")。無ければ空。 */
  orderTimeOf: (order: fhir4.ServiceRequest) => string;
  buildDeleteBundle: (
    srId: string,
    itemIds: string[],
    responseIds: string[],
    appointmentEntries: fhir4.BundleEntry[],
  ) => fhir4.Bundle;
  /** 実施の取消で消す実施記録(Procedure・薬剤の使用)の削除エントリ。 */
  buildPerformDeleteEntries: (
    procedures: fhir4.Procedure[],
    administrations: fhir4.MedicationAdministration[],
  ) => fhir4.BundleEntry[];
  buildTaskUpdate: (
    task: fhir4.Task | undefined,
    order: fhir4.ServiceRequest,
    status: ExamTaskStatus,
  ) => fhir4.Task;
  tasksByOrderId: (tasks: fhir4.Task[]) => Map<string, fhir4.Task>;
  taskStatus: (task: fhir4.Task | undefined) => ExamTaskStatus;
}

export function createExamOrderQueries(config: ExamOrderQueriesConfig) {
  const { dept } = config;
  const worklistKey = `${dept}-worklist`;
  const WORKLIST_KEY = (date: string) => ["ServiceRequest", worklistKey, date];

  const useOrderDetail = makeOrderDetailHook(`${dept}-order`, ORDER_ITEM_REVINCLUDES);

  const usePerformDetail = makePerformDetailHook(`${dept}-perform`, { observations: false });

  async function fetchWorklist(date: string): Promise<ExamWorklistResult> {
    const orders: fhir4.ServiceRequest[] = [];
    const items: fhir4.ServiceRequest[] = [];
    const reportByOrderId = new Map<string, { id: string; status: string }>();

    const { patientsById, tasks, truncated } = await fetchWorklistBundles(
      (page) => {
        const params = worklistParams(
          `${ORDER_TYPE_SYSTEM}|${config.orderType.code}`,
          date,
          page,
          "occurrence",
        );
        // 検査項目・進捗・所見レポートも同じ応答に添えてもらう。
        // _revinclude は複数指定するので append(set だと先に入れたものが消える)。
        params.set("_revinclude:iterate", "ServiceRequest:based-on");
        params.append("_revinclude", "Task:focus");
        params.append("_revinclude", "DiagnosticReport:based-on");
        return params;
      },
      (resource) => {
        if (resource.resourceType === "DiagnosticReport") {
          const report = resource as fhir4.DiagnosticReport;
          const orderId = report.basedOn?.[0]?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
          if (orderId && report.id && isExamReport(config.reportConfig, report)) {
            reportByOrderId.set(orderId, { id: report.id, status: report.status });
          }
          return false;
        }
        if (resource.resourceType !== "ServiceRequest") return false;
        const request = resource as fhir4.ServiceRequest;
        // 検索にヒットしたヘッダと、添えられた明細を分ける。
        if (config.isServiceRequest(request) && !request.basedOn?.length) {
          orders.push(request);
          return true;
        }
        items.push(request);
        return false;
      },
    );

    const taskByOrderId = config.tasksByOrderId(tasks);

    const rows = orders.map((order) => ({
      order,
      itemRequests: config.itemRequestsOf(items, order.id ?? ""),
      patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
      task: taskByOrderId.get(order.id ?? ""),
      reportId: reportByOrderId.get(order.id ?? "")?.id ?? "",
      reportStatus: reportByOrderId.get(order.id ?? "")?.status ?? "",
    }));

    // 実施時刻の早い順。時刻を指定していないオーダー(実施日だけ)は後ろにまとめる。
    rows.sort((a, b) => worklistSortKey(a).localeCompare(worklistSortKey(b)));

    return { rows, truncated };
  }

  function worklistSortKey(row: ExamWorklistRow): string {
    return config.orderTimeOf(row.order) || "99:99";
  }

  /** 実施日 1 日ぶんのオーダー。日付が未選択の間は読みに行かない。 */
  function useWorklist(date: string) {
    return useQuery({
      queryKey: WORKLIST_KEY(date),
      queryFn: () => fetchWorklist(date),
      enabled: Boolean(date),
      placeholderData: keepPreviousData,
    });
  }

  /**
   * 受付・実施などの進捗を書き込む。実施済から戻す(取消)ときは、実施記録も同じ transaction で消す。
   * 所見レポートが付いた検査は取り消させない(docs/exam-report-design.md)。
   */
  const useUpdateTaskStatus = makeUpdateTaskStatusHook<ExamTaskStatus>(config.buildTaskUpdate, worklistKey, {
    releaseAppointments: true,
    cancelPerform: {
      cancels: cancelsPerform(config.taskStatus),
      entries: async (order) => {
        await assertNoExamReportForCancel(config.reportConfig, order.id ?? "");
        return performCancelEntries(order.id ?? "", { observations: false }, config.buildPerformDeleteEntries);
      },
    },
  });

  /**
   * 実施登録。実施記録(Procedure 一式)と Task の完了を 1 つの transaction で書き込む。
   * Bundle の組み立ては部門の *ResultHelpers を参照。
   */
  function useRegisterPerform() {
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["ServiceRequest", worklistKey] });
        queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
        queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
      },
    });
  }

  /**
   * オーダーの更新。予約日時を変えたときは、予約の付け替え(Appointment の日時と枠の busy/free)も
   * 同じ transaction で書く。オーダーだけ・予約だけが動いて実施日時が食い違うことを防ぐため。
   */
  function useUpdateOrder() {
    const queryClient = useQueryClient();
    const withProvenance = useWithOrderProvenance();
    return useMutation({
      mutationFn: async ({
        bundle,
        booking,
      }: {
        bundle: fhir4.Bundle;
        booking: RadBookingChange | null;
      }) => {
        if (!booking) return postBundle(withProvenance(bundle));
        // 空きに戻す元の枠は参照しか持っていないので、ここで引き直す(取消と同じ)。
        const entries = buildRescheduleEntries(
          booking.appointment,
          await fetchAppointmentSlots(booking.appointment),
          booking.slots,
        );
        return postBundle(withProvenance({ ...bundle, entry: [...(bundle.entry ?? []), ...entries] }));
      },
      onSuccess: () => {
        // 実施日時が動くと部門一覧の当日ぶんも変わるので、ServiceRequest はまとめて読み直させる。
        queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
        invalidateAppointments(queryClient);
        invalidateProvenance(queryClient);
      },
    });
  }

  /**
   * 明細が参照しているテンプレート回答と、紐づく検査予約の取消も同じ transaction に同梱する。
   * 所見レポートが付いたオーダーは消させない(レポートの basedOn が指す先が無くなる)。
   * useDeleteOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
   */
  const deleteOrderRequest = (srId: string) =>
    deleteOrderWithItems(srId, {
      itemsOf: config.itemRequestsOf,
      withAppointment: true,
      revincludes: ["DiagnosticReport:based-on"],
      guard: examReportDeleteGuard(config.reportConfig),
      build: ({ srId, itemIds, itemRequests, appointmentEntries }) =>
        config.buildDeleteBundle(srId, itemIds, config.responseIdsOf(itemRequests), appointmentEntries),
    });

  function useDeleteOrder() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: deleteOrderRequest,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
        queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
        queryClient.invalidateQueries({ queryKey: ["Appointment"] });
        queryClient.invalidateQueries({ queryKey: ["Slot"] });
        invalidateOrderDependents(queryClient);
      },
    });
  }

  return {
    useOrderDetail,
    usePerformDetail,
    useWorklist,
    useUpdateTaskStatus,
    useRegisterPerform,
    useUpdateOrder,
    deleteOrderRequest,
    useDeleteOrder,
  };
}
