import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_TYPE_SYSTEM } from "../../fhir/prescriptionHelpers";
import { buildRehabOrderCloseEntry, isRehabServiceRequest, REHAB_ORDER_TYPE } from "../../fhir/rehabOrderHelpers";
import { buildRehabTaskUpdate, rehabTasksByOrderId, type RehabTaskStatus } from "../../fhir/rehabTaskHelpers";
import { type RehabPerformDisplay, rehabPerformsByOrderId } from "../../fhir/rehabResultHelpers";
import { SERVICE_TYPE_SYSTEM as SCHEDULE_SERVICE_TYPE_SYSTEM } from "../../fhir/scheduleHelpers";
import { appointmentOrderId, buildRehabAppointmentBundle, type SlotSelection } from "../../fhir/appointmentHelpers";
import { deleteResource, postBundle } from "../fhirClient";
import { fetchOrderAppointmentCancelEntries, invalidateAppointments, setActiveAppointmentStatus } from "./appointment";
import {
  makeOrderDetailHook,
  ORDER_PERFORM_REVINCLUDES,
  searchAllPages,
  setOrderPeriod,
  WORKLIST_PAGE,
} from "./core";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";
import { comparePatientNumber, fetchWorklistBundles, taskBundleEntry } from "./worklist";

// ---- リハビリオーダー ----
//
// 食事と同じ期間継続型なので、明細を持たずヘッダ 1 本で済む。食事と違うのは進捗
// Task と実施記録(Procedure)を持つところで、Task は「部門の受け入れ状態」を表し、
// 日々の実施は Task を動かさず Procedure が積み上がる
// (docs/rehab-order-design.md §4)。
//
// 「基準日に効いている(始まっていて、まだ終わっていない)」は order-period で引く
// (開始は occurrenceDateTime、終了は rehab-order-end 拡張を上流が索引している)。

export const useRehabOrderDetail = makeOrderDetailHook<fhir4.Resource>("rehab-order", ORDER_PERFORM_REVINCLUDES);

/**
 * その患者の有効なリハビリオーダー。退院で打ち切る対象を選ぶのに使う。
 * どれを止めるかは退院日で決まるので、絞り込み(rehabOrderNeedsStop)は画面側で行う
 * (usePatientMealOrders と同じ作り)。
 */
export function usePatientRehabOrders(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${REHAB_ORDER_TYPE.code}`);
  params.set("status", "active");
  params.set("_sort", "-authoredon");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "rehab-patient", patientId],
    queryFn: async () => {
      // 打ち切りの対象を取りこぼさないよう、ページを辿って全件読む。
      const { matches } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, { page: 500, maxPages: 4 });
      return matches.filter(isRehabServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

export function useUpdateRehabOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      // 開始日が動くとカードの載る日も変わるので、まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * オーダーを消す。明細は持たないが、リハ部門が取った予約は道連れで取り消す
 * (放射線オーダーの削除と同じ後始末。予約だけが残って枠を塞ぐのを防ぐ)。
 *
 * useDeleteRehabOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteRehabOrderRequest = async (srId: string) => {
  const appointmentEntries = await fetchOrderAppointmentCancelEntries(srId);
  return postBundle({
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...appointmentEntries,
      { request: { method: "DELETE", url: `ServiceRequest/${srId}` } },
    ],
  });
};

export function useDeleteRehabOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRehabOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      invalidateAppointments(queryClient);
    },
  });
}

// ---- リハビリ一覧(部門ワークリスト) ----
//
// 他部門の一覧は「その日に実施予定のオーダー」を日付一致で引くが、リハビリは期間型
// なので「基準日に効いている(始まっていて、まだ終わっていない)オーダー」を
// order-period で引く。
//
// 疾患別リハ区分・療法種別・入外区分・病棟・診療科・進捗での絞り込みは画面側で行う
// (理由は api/queries/rad.ts の「放射線検査一覧」の節)。

/** リハビリ一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface RehabWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 進捗(= 部門の受け入れ状態)。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** 基準日の実施記録。期間中は何度も実施するので「その日に実施したか」で見る。 */
  todayPerforms: RehabPerformDisplay[];
  /** 基準日以降の予約(近い順)。先頭が「次回予約」。 */
  appointments: fhir4.Appointment[];
}

export interface RehabWorklistResult {
  rows: RehabWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

/**
 * 基準日に効いているリハビリオーダーのヘッダ検索。worklistParams を使わないのは
 * 日付の当て方が違うため(他部門は実施予定日の一致、リハビリは期間の重なり)。
 */
function rehabWorklistParams(date: string, page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${REHAB_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, date, date);
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

/** 基準日 1 日ぶんのリハビリ実施記録。オーダーの id ごとにまとめる。 */
async function fetchRehabPerformsOn(date: string): Promise<Map<string, RehabPerformDisplay[]>> {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${REHAB_ORDER_TYPE.code}`);
  params.set("date", date);

  const { matches } = await searchAllPages<fhir4.Procedure>("Procedure", params, { page: 500, maxPages: 4 });
  return rehabPerformsByOrderId(matches);
}

async function fetchRehabWorklist(date: string): Promise<RehabWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => rehabWorklistParams(date, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isRehabServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );

  // 実施記録はその日の分、予約は基準日以降の分だけが要るので別に引く。_revinclude だと
  // 継続中のオーダーの全期間ぶんが付いてくる。
  const [performsByOrderId, appointmentsByOrderId] = await Promise.all([
    fetchRehabPerformsOn(date),
    fetchRehabAppointmentsFrom(date),
  ]);

  const taskByOrderId = rehabTasksByOrderId(tasks);

  const rows = orders
    .map((order) => ({
      order,
      patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
      task: taskByOrderId.get(order.id ?? ""),
      todayPerforms: performsByOrderId.get(order.id ?? "") ?? [],
      appointments: appointmentsByOrderId.get(order.id ?? "") ?? [],
    }));

  // 日単位の一覧では患者番号順が扱いやすい(病理・輸血と同じ)。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** 基準日に効いているリハビリオーダー。日付が未選択の間は読みに行かない。 */
export function useRehabWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "rehab-worklist", date],
    queryFn: () => fetchRehabWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

// ---- リハビリの予約 ----
//
// リハ室の枠(Schedule の serviceType = rehab)に対して、部門が受付後に「次回予約」を
// 都度取る。オーダー登録の transaction には同梱しない(理由は appointmentHelpers の
// buildRehabAppointmentBundle を参照)。

/**
 * 基準日以降のリハビリ予約を、オーダーの id ごとにまとめる(それぞれ日時の近い順)。
 * オーダー一覧の「次回予約」列と「本日の予約」ビューを 1 回の問い合わせで賄う。
 */
async function fetchRehabAppointmentsFrom(
  from: string,
): Promise<Map<string, fhir4.Appointment[]>> {
  const params = new URLSearchParams();
  params.set("date", `ge${from}`);
  params.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|rehab`);
  setActiveAppointmentStatus(params);
  params.set("_sort", "date");

  const { matches: appointments } = await searchAllPages<fhir4.Appointment>("Appointment", params, { page: 500, maxPages: 4 });

  const byOrderId = new Map<string, fhir4.Appointment[]>();
  for (const appointment of appointments) {
    const orderId = appointmentOrderId(appointment);
    if (!orderId) continue;
    const list = byOrderId.get(orderId);
    if (list) list.push(appointment);
    else byOrderId.set(orderId, [appointment]);
  }
  for (const list of byOrderId.values()) {
    list.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  }
  return byOrderId;
}

/** リハビリの予約を取る。オーダーを basedOn に持つ Appointment + 枠の busy 化。 */
export function useBookRehabAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      patient,
      selection,
      orderId,
    }: {
      patient: fhir4.Patient;
      selection: SlotSelection;
      orderId: string;
    }) => postBundle(buildRehabAppointmentBundle(patient, selection, orderId)),
    onSuccess: () => {
      invalidateAppointments(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rehab-worklist"] });
    },
  });
}

// ---- リハビリの実施記録 ----
//
// 実施は Procedure を 1 件足すだけで進捗 Task を動かさない。他部門の実施と唯一
// 作りが違う点(rehabResultHelpers.ts の冒頭コメント / docs/rehab-order-design.md §4)。

/** リハビリの進捗・実施記録・予約が動いたときに読み直させるもの。 */
function invalidateRehab(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rehab-worklist"] });
  // カルテのオーダーカードも進捗と実施履歴を出しているので読み直させる。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
  // パスから受付前に実施すると Task も受付済になる。患者の Task の一覧(パスの実施入力が読む)も読み直させる。
  queryClient.invalidateQueries({ queryKey: ["Task", "search"] });
}

/**
 * 実施登録。Procedure を 1 件 POST するだけで Task は動かさない。
 * (他部門の useRegisterXxxPerform は Task を completed にする Bundle を受け取るが、
 * リハビリは期間中ずっと受付済のままなので、それに合わせてはいけない。)
 */
export function useRegisterRehabPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateRehab(queryClient),
  });
}

/** 実施の取消。Procedure を消すだけ(進捗は実施で動いていないので戻す先が無い)。 */
export function useDeleteRehabPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (procedureId: string) => deleteResource("Procedure", procedureId),
    onSuccess: () => invalidateRehab(queryClient),
  });
}

/**
 * 受付・終了・中止などの進捗を書き込む。Task がまだ無いオーダーでは新しく作る。
 *
 * 「終了」だけは ServiceRequest にも終了日を書く。Task を completed にするだけでは
 * status=active のまま残り、部門一覧の `occurrence=le{基準日}` に永久にヒットし
 * 続けるため(docs/rehab-order-design.md)。
 *
 * 逆に「終了取消」では終了日を消さない。打ち切った期間まで巻き戻すと、その間に
 * 積んだ実施記録との整合が取れなくなるため。期間を延ばしたいときはオーダーを編集する。
 */
export function useUpdateRehabTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      order,
      task,
      status,
      /** 終了日。status が completed のときだけ使う。 */
      endDate,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: RehabTaskStatus;
      endDate?: string;
    }) => {
      const entry: fhir4.BundleEntry[] = [taskBundleEntry(buildRehabTaskUpdate(task, order, status))];
      if (status === "completed" && endDate) {
        entry.push(buildRehabOrderCloseEntry(order, endDate));
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    onSuccess: () => invalidateRehab(queryClient),
  });
}
