import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EXAM_REPORT_CONFIGS, isExamReport } from "../../fhir/examReportHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import {
  buildEndoscopyOrderDeleteBundle,
  ENDOSCOPY_ORDER_TYPE,
  endoscopyOrderItemRequests,
  endoscopyOrderResponseIds,
  endoscopyOrderTime,
  isEndoscopyServiceRequest,
} from "../../fhir/endoscopyOrderHelpers";
import { buildEndoscopyPerformDeleteEntries } from "../../fhir/endoscopyResultHelpers";
import {
  buildEndoscopyTaskUpdate,
  endoscopyTasksByOrderId,
  endoscopyTaskStatus,
  type EndoscopyTaskStatus,
} from "../../fhir/endoscopyTaskHelpers";
import { buildRescheduleEntries } from "../../fhir/appointmentHelpers";
import { postBundle } from "../fhirClient";
import { fetchAppointmentSlots, invalidateAppointments } from "./appointment";
import { makeOrderDetailHook, ORDER_ITEM_REVINCLUDES } from "./core";
import { assertNoExamReportForCancel, examReportDeleteGuard } from "./examReport";
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
} from "./worklist";

// ---- 内視鏡オーダー ----
//
// 生理検査と同じ形。ヘッダと明細が別リソースなので 1 リクエストにまとめて取り、
// 部門一覧・実施記録・予約の扱いも同型にしている。

export const useEndoscopyOrderDetail = makeOrderDetailHook("endoscopy-order", ORDER_ITEM_REVINCLUDES);

export const useEndoscopyPerformDetail = makePerformDetailHook("endoscopy-perform", { observations: false });

/** 内視鏡一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface EndoscopyWorklistRow {
  order: fhir4.ServiceRequest;
  /** 検査項目(明細)。セットの構成項目まで含む平坦な一覧。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** 所見レポート。未登録なら空。 */
  reportId: string;
  reportStatus: string;
}

export interface EndoscopyWorklistResult {
  rows: EndoscopyWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchEndoscopyWorklist(date: string): Promise<EndoscopyWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];
  const reportByOrderId = new Map<string, { id: string; status: string }>();

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${ENDOSCOPY_ORDER_TYPE.code}`,
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
        if (orderId && report.id && isExamReport(EXAM_REPORT_CONFIGS.endoscopy, report)) {
          reportByOrderId.set(orderId, { id: report.id, status: report.status });
        }
        return false;
      }
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      // 検索にヒットしたヘッダと、添えられた明細を分ける。
      if (isEndoscopyServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = endoscopyTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: endoscopyOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
    reportId: reportByOrderId.get(order.id ?? "")?.id ?? "",
    reportStatus: reportByOrderId.get(order.id ?? "")?.status ?? "",
  }));

  // 実施時刻の早い順。時刻を指定していないオーダー(実施日だけ)は後ろにまとめる。
  rows.sort((a, b) => endoscopyWorklistSortKey(a).localeCompare(endoscopyWorklistSortKey(b)));

  return { rows, truncated };
}

function endoscopyWorklistSortKey(row: EndoscopyWorklistRow): string {
  return endoscopyOrderTime(row.order) || "99:99";
}

/** 実施日 1 日ぶんの内視鏡オーダー。日付が未選択の間は読みに行かない。 */
export function useEndoscopyWorklist(date: string) {
  return useQuery({
    queryKey: ENDOSCOPY_WORKLIST_KEY(date),
    queryFn: () => fetchEndoscopyWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

const ENDOSCOPY_WORKLIST_KEY = (date: string) => ["ServiceRequest", "endoscopy-worklist", date];

/**
 * 受付・実施などの進捗を書き込む。実施済から戻す(取消)ときは、実施記録も同じ transaction で消す。
 * 所見レポートが付いた検査は取り消させない(docs/exam-report-design.md)。
 */
export const useUpdateEndoscopyTaskStatus = makeUpdateTaskStatusHook<EndoscopyTaskStatus>(
  buildEndoscopyTaskUpdate,
  "endoscopy-worklist",
  {
    cancelPerform: {
      cancels: cancelsPerform(endoscopyTaskStatus),
      entries: async (order) => {
        await assertNoExamReportForCancel(EXAM_REPORT_CONFIGS.endoscopy, order.id ?? "");
        return performCancelEntries(order.id ?? "", { observations: false }, buildEndoscopyPerformDeleteEntries);
      },
    },
  },
);

/**
 * 内視鏡の実施登録。実施記録(Procedure 一式)と Task の完了を 1 つの
 * transaction で書き込む。Bundle の組み立ては endoscopyResultHelpers を参照。
 */
export function useRegisterEndoscopyPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "endoscopy-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}

/**
 * 内視鏡オーダーの更新。予約日時を変えたときは、予約の付け替え(Appointment の
 * 日時と枠の busy/free)も同じ transaction で書く。オーダーだけ・予約だけが動いて
 * 実施日時が食い違うことを防ぐため。
 */
export function useUpdateEndoscopyOrder() {
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
      // 実施日時が動くと内視鏡一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateAppointments(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 明細が参照しているテンプレート回答と、紐づく検査予約の取消も同じ transaction に同梱する。
 * 所見レポートが付いたオーダーは消させない(レポートの basedOn が指す先が無くなる)。
 * useDeleteEndoscopyOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteEndoscopyOrderRequest = (srId: string) =>
  deleteOrderWithItems(srId, {
    itemsOf: endoscopyOrderItemRequests,
    withAppointment: true,
    revincludes: ["DiagnosticReport:based-on"],
    guard: examReportDeleteGuard(EXAM_REPORT_CONFIGS.endoscopy),
    build: ({ srId, itemIds, itemRequests, appointmentEntries }) =>
      buildEndoscopyOrderDeleteBundle(
        srId,
        itemIds,
        endoscopyOrderResponseIds(itemRequests),
        appointmentEntries,
      ),
  });

export function useDeleteEndoscopyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteEndoscopyOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Appointment"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}
