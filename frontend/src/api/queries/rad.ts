import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildCancelledNotificationTask, notificationTaskEntry } from "../../fhir/notificationHelpers";
import { RAD_CRITICAL_FINDING_TASK_CODE, radCriticalFindingEntries } from "../../fhir/radCriticalFindingHelpers";
import {
  buildRadReportDeleteEntries,
  isRadReport,
  RAD_REPORT_CATEGORY_SEARCH,
  RAD_REPORT_TOO_LARGE_MESSAGE,
  radCriticalFindingOf,
  radReportBundleTooLarge,
} from "../../fhir/radReportHelpers";
import {
  isReviewableReportStatus,
  RESULT_REVIEW_TASK_CODE,
  urgentAwareReviewTaskEntries,
  urgentNotificationOpenAfter,
} from "../../fhir/resultReviewHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/prescriptionHelpers";
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
import { postBundle, readResource, searchResource } from "../fhirClient";
import { fetchAppointmentSlots, invalidateAppointments } from "./appointment";
import { NOTIFICATION_TASK_KEY, resourcesOfType } from "./core";
import { useLabResultDetail } from "./labResult";
import { fetchOrderRequester, fetchReportTasks } from "./notification";
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
        if (orderId && report.id && isRadReport(report)) {
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
        if (await radOrderHasReport(order.id ?? "")) {
          throw new Error("読影レポートがあるため取り消せません。読影レポートを削除してから取り消してください。");
        }
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

// ---- 放射線検査の読影レポート ----
//
// 構造は fhir/radReportHelpers(docs/rad-report-design.md)。オーダー 1 件に読影レポート 1 件。

/** オーダーに読影レポートが付いているか。実施の取消を止めるのに使う。 */
async function radOrderHasReport(orderId: string): Promise<boolean> {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("category", RAD_REPORT_CATEGORY_SEARCH);
  params.set("_summary", "count");
  const { data: bundle } = await searchResource<fhir4.DiagnosticReport>("DiagnosticReport", params);
  return (bundle.total ?? 0) > 0;
}

/** オーダーに付いた読影レポート(所見の Observation を添える)。入力モーダルが使う。 */
export function useRadReportByOrder(orderId: string | undefined) {
  const params = new URLSearchParams();
  if (orderId) params.set("based-on", `ServiceRequest/${orderId}`);
  params.append("_include", "DiagnosticReport:result");
  params.set("_count", "10");

  return useQuery({
    queryKey: ["DiagnosticReport", "detail", "rad-order", orderId],
    queryFn: () => searchResource<fhir4.Resource>("DiagnosticReport", params),
    enabled: Boolean(orderId),
  });
}

/** 読影レポートの内容(所見の Observation を添える)。取得の形は検体検査結果と同じ。 */
export function useRadReportDetail(reportId: string | undefined) {
  return useLabResultDetail(reportId);
}

const RAD_REPORT_TASK_CODES = [RESULT_REVIEW_TASK_CODE.code, RAD_CRITICAL_FINDING_TASK_CODE.code];

/**
 * 読影レポート保存の Bundle に通知を足す。宛先(依頼医)と既存の通知 2 種はここで引く。
 *
 * - 重要所見: 要点があれば暫定報告でも出す。要点の変更で未確認に戻し、外したら取り下げる
 * - 検査結果確認: 最終報告・訂正報告になったとき(暫定報告では出さない)。ただし重要所見が
 *   未確認で残る間は出さず、未確認のものは取り下げる(重要所見の確認で既読も残すため)
 */
async function withRadReportTasks(bundle: fhir4.Bundle): Promise<fhir4.Bundle> {
  const entry = bundle.entry ?? [];
  const reportEntry = entry.find((e) => e.resource?.resourceType === "DiagnosticReport");
  const report = reportEntry?.resource as fhir4.DiagnosticReport | undefined;
  const reference = report?.id ? `DiagnosticReport/${report.id}` : reportEntry?.fullUrl;
  if (!report || !reference) return bundle;

  const patientId = report.subject?.reference?.split("/").pop() ?? "";
  const orderReference = report.basedOn?.[0]?.reference;
  const orderId = orderReference?.split("/").pop();
  const [owner, tasks] = await Promise.all([
    orderId ? fetchOrderRequester(orderId) : Promise.resolve(undefined),
    report.id
      ? fetchReportTasks(report.id, RAD_REPORT_TASK_CODES)
      : Promise.resolve(new Map<string, fhir4.Task>()),
  ]);

  const date = report.effectiveDateTime?.slice(0, 10) ?? "";
  const exam = report.code?.text ?? "";
  const basedOn = orderReference ? [{ reference: orderReference }] : undefined;

  const existingCritical = tasks.get(RAD_CRITICAL_FINDING_TASK_CODE.code);
  const criticalEntries = radCriticalFindingEntries(
    { reportReference: reference, patientId, owner, date, exam, point: radCriticalFindingOf(report), basedOn },
    existingCritical,
  );

  return {
    ...bundle,
    entry: [
      ...entry,
      ...criticalEntries,
      ...urgentAwareReviewTaskEntries(
        { reportReference: reference, patientId, owner, kind: "rad", date, summary: exam, basedOn },
        isReviewableReportStatus(report.status),
        tasks.get(RESULT_REVIEW_TASK_CODE.code),
        urgentNotificationOpenAfter(criticalEntries, existingCritical),
      ),
    ],
  };
}

function invalidateRadReport(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
  queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rad-worklist"] });
  queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse"] });
  queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
}

/**
 * 読影レポートの登録・更新(Bundle は radReportHelpers の buildRadReportBundle)。
 * 新しく送る画像が上流の本文上限に届く量なら、送る前に止める。
 */
export function useSaveRadReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bundle: fhir4.Bundle) => {
      if (radReportBundleTooLarge(bundle)) throw new Error(RAD_REPORT_TOO_LARGE_MESSAGE);
      return postBundle(await withRadReportTasks(bundle));
    },
    retry: false,
    onSuccess: () => invalidateRadReport(queryClient),
  });
}

/**
 * 読影レポートの削除。所見・テンプレート回答を消し、未確認の通知(検査結果確認・重要所見)を
 * 取り下げる。削除したレポートを指す通知が未確認のまま残らないようにするため。
 */
export function useDeleteRadReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: string) => {
      const [{ data: report }, tasks] = await Promise.all([
        readResource<fhir4.DiagnosticReport>("DiagnosticReport", reportId),
        fetchReportTasks(reportId, RAD_REPORT_TASK_CODES),
      ]);
      const cancelEntries = Array.from(tasks.values())
        .filter((task) => task.status === "requested")
        .map((task) => notificationTaskEntry(buildCancelledNotificationTask(task), task.id));
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [...buildRadReportDeleteEntries(report), ...cancelEntries],
      });
    },
    retry: false,
    onSuccess: () => invalidateRadReport(queryClient),
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
    guard: (bundle) => {
      if (resourcesOfType<fhir4.DiagnosticReport>(bundle, "DiagnosticReport").some(isRadReport)) {
        throw new Error("読影レポートがあるため削除できません。読影レポートを削除してから削除してください。");
      }
    },
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
