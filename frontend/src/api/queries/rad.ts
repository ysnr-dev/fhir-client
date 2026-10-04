import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EXAM_REPORT_CONFIGS, isExamReport } from "../../fhir/examReportHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import {
  buildRadOrderDeleteBundle,
  isRadServiceRequest,
  RAD_ORDER_TYPE,
  radOrderItemRequests,
  radOrderResponseIds,
  radOrderTime,
} from "../../fhir/radOrderHelpers";
import { buildRadPerformDeleteEntries } from "../../fhir/radResultHelpers";
import { buildRadTaskUpdate, radTasksByOrderId, radTaskStatus, type RadTaskStatus } from "../../fhir/radTaskHelpers";
import { buildRescheduleEntries } from "../../fhir/appointmentHelpers";
import { postBundle } from "../fhirClient";
import { fetchAppointmentSlots, invalidateAppointments } from "./appointment";
import { assertNoExamReportForCancel, examReportDeleteGuard } from "./examReport";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";
import {
  cancelsPerform,
  deleteOrderWithItems,
  fetchWorklistBundles,
  makeUpdateTaskStatusHook,
  performCancelEntries,
  worklistParams,
} from "./worklist";

// ---- 放射線検査一覧(部門ワークリスト) ----
//
// 撮影日で 1 日ぶんの放射線検査オーダーを読み、モダリティ・入外区分・診療科・
// ステータスでの絞り込みは画面側で行う。上流は診療科・病棟(拡張)や進捗
// (_has:Task:focus:status)でも絞れるが、絞り込みの選択肢をその日の
// オーダーから組み立てている(RadWorklistPage を参照)ため、サーバーで絞ると
// 選んだ値しか候補に出なくなる。1 日ぶんなら数十件なので、全件読んでから絞る方が、
// ページごとに絞り込み結果が変わる作りより扱いやすい。
//
// 撮影日は ServiceRequest.occurrenceDateTime(実施予定日時)で引く。

/** 放射線検査一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface RadWorklistRow {
  order: fhir4.ServiceRequest;
  /** 撮影項目(明細)。セットの構成項目まで含む平坦な一覧。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** 読影レポート。未登録なら空。 */
  reportId: string;
  reportStatus: string;
}

export interface RadWorklistResult {
  rows: RadWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchRadWorklist(date: string): Promise<RadWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];
  const reportByOrderId = new Map<string, { id: string; status: string }>();

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${RAD_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 撮影項目・進捗・読影レポートも同じ応答に添えてもらう。
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
        if (orderId && report.id && isExamReport(EXAM_REPORT_CONFIGS.rad, report)) {
          reportByOrderId.set(orderId, { id: report.id, status: report.status });
        }
        return false;
      }
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      // 検索にヒットしたヘッダと、添えられた明細を分ける。
      if (isRadServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = radTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: radOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
    reportId: reportByOrderId.get(order.id ?? "")?.id ?? "",
    reportStatus: reportByOrderId.get(order.id ?? "")?.status ?? "",
  }));

  // 撮影時刻の早い順。時刻を指定していないオーダー(撮影日だけ)は後ろにまとめる。
  rows.sort((a, b) => radWorklistSortKey(a).localeCompare(radWorklistSortKey(b)));

  return { rows, truncated };
}

function radWorklistSortKey(row: RadWorklistRow): string {
  const time = radOrderTime(row.order);
  return time || "99:99";
}

/** 撮影日 1 日ぶんの放射線検査オーダー。日付が未選択の間は読みに行かない。 */
export function useRadWorklist(date: string) {
  return useQuery({
    queryKey: RAD_WORKLIST_KEY(date),
    queryFn: () => fetchRadWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

const RAD_WORKLIST_KEY = (date: string) => ["ServiceRequest", "rad-worklist", date];

/**
 * 受付・実施などの進捗を書き込む。実施済から戻す(取消)ときは、実施記録も同じ transaction で消す。
 * 読影レポートが付いた検査は取り消させない。実施記録を消すとレポートの撮影日時の
 * 根拠が消え、撮っていない検査に読影が残る(docs/rad-report-design.md §8)。
 */
export const useUpdateRadTaskStatus = makeUpdateTaskStatusHook<RadTaskStatus>(
  buildRadTaskUpdate,
  "rad-worklist",
  {
    cancelPerform: {
      cancels: cancelsPerform(radTaskStatus),
      entries: async (order) => {
        await assertNoExamReportForCancel(EXAM_REPORT_CONFIGS.rad, order.id ?? "");
        return performCancelEntries(order.id ?? "", { observations: true }, buildRadPerformDeleteEntries);
      },
    },
  },
);

/**
 * 放射線検査の実施登録。実施記録(Procedure 一式)と Task の完了を 1 つの
 * transaction で書き込む。Bundle の組み立ては radResultHelpers を参照。
 */
export function useRegisterRadPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rad-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}

/** 予約日時の変更(付け替え先の枠)。放射線オーダーの更新に同梱する。 */
export interface RadBookingChange {
  appointment: fhir4.Appointment;
  slots: fhir4.Slot[];
}

/**
 * 放射線オーダーの更新。予約日時を変えたときは、予約の付け替え(Appointment の日時と
 * 枠の busy/free)も同じ transaction で書く。オーダーだけ・予約だけが動いて撮影日時が
 * 食い違うことを防ぐため。
 *
 * ヘッダの撮影日時は Bundle を組む前に新しい枠の日時にしてある(フォームが枠を選んだ
 * 時点で書き換える)ので、ここではオーダー側に触らない。
 */
export function useUpdateRadOrder() {
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
      // 撮影日時が動くと放射線検査一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateAppointments(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 明細が参照しているテンプレート回答と、紐づく検査予約の取消も同じ transaction に同梱する。
 * 読影レポートが付いたオーダーは消させない(レポートの basedOn が指す先が無くなる)。
 * useDeleteRadOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteRadOrderRequest = (srId: string) =>
  deleteOrderWithItems(srId, {
    itemsOf: radOrderItemRequests,
    withAppointment: true,
    revincludes: ["DiagnosticReport:based-on"],
    guard: examReportDeleteGuard(EXAM_REPORT_CONFIGS.rad),
    build: ({ srId, itemIds, itemRequests, appointmentEntries }) =>
      buildRadOrderDeleteBundle(srId, itemIds, radOrderResponseIds(itemRequests), appointmentEntries),
  });

export function useDeleteRadOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRadOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Appointment"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}
