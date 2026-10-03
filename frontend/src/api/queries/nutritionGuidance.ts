import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_TYPE_SYSTEM } from "../../fhir/prescriptionHelpers";
import {
  buildNutritionGuidanceOrderCloseEntry,
  isNutritionGuidanceServiceRequest,
  NUTRITION_GUIDANCE_ORDER_TYPE,
  nutritionGuidanceOrderResponseIds,
} from "../../fhir/nutritionGuidanceOrderHelpers";
import {
  buildNutritionGuidanceTaskUpdate,
  nutritionGuidanceTasksByOrderId,
  type NutritionGuidanceTaskStatus,
} from "../../fhir/nutritionGuidanceTaskHelpers";
import {
  buildNutritionGuidancePerformDeleteEntries,
  type NutritionGuidancePerformDisplay,
  nutritionGuidancePerformsByOrderId,
} from "../../fhir/nutritionGuidanceResultHelpers";
import { SERVICE_TYPE_SYSTEM as SCHEDULE_SERVICE_TYPE_SYSTEM } from "../../fhir/scheduleHelpers";
import { appointmentOrderId, buildNutritionGuidanceAppointmentBundle, type SlotSelection } from "../../fhir/appointmentHelpers";
import { postBundle, readResource } from "../fhirClient";
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

// ---- 栄養指導オーダー ----
//
// リハビリと同じ期間継続型なので、明細を持たずヘッダ 1 本 + 進捗 Task + 実施記録
// (Procedure)で構成する。Task は「部門の受け入れ状態」を表し、日々の指導は Task を
// 動かさず Procedure が積み上がる(docs/nutrition-guidance-order-design.md §3)。
// 「基準日に効いている」はリハビリと同じく order-period で引く。

export const useNutritionGuidanceOrderDetail = makeOrderDetailHook<fhir4.Resource>("nutrition-guidance-order", ORDER_PERFORM_REVINCLUDES);

/**
 * その患者の有効な栄養指導オーダー。退院で打ち切る対象を選ぶのに使う。
 * どれを止めるかは退院日で決まるので、絞り込み(nutritionGuidanceOrderNeedsStop)は
 * 画面側で行う(usePatientRehabOrders と同じ作り)。
 */
export function usePatientNutritionGuidanceOrders(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${NUTRITION_GUIDANCE_ORDER_TYPE.code}`);
  params.set("status", "active");
  params.set("_sort", "-authoredon");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "nutrition-guidance-patient", patientId],
    queryFn: async () => {
      // 打ち切りの対象を取りこぼさないよう、ページを辿って全件読む。
      const { matches } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, { page: 500, maxPages: 4 });
      return matches.filter(isNutritionGuidanceServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

export function useUpdateNutritionGuidanceOrder() {
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
 * オーダーを消す。明細は持たないが、栄養部門が取った予約は道連れで取り消し
 * (リハビリオーダーの削除と同じ後始末。予約だけが残って枠を塞ぐのを防ぐ)、
 * 指導目的をテンプレートから書いていれば記入内容も一緒に消す
 * (オーダーが消えると誰も参照しない孤児になるため)。
 *
 * useDeleteNutritionGuidanceOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteNutritionGuidanceOrderRequest = async (srId: string) => {
  const [{ data: order }, appointmentEntries] = await Promise.all([
    readResource<fhir4.ServiceRequest>("ServiceRequest", srId),
    fetchOrderAppointmentCancelEntries(srId),
  ]);
  return postBundle({
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...appointmentEntries,
      ...nutritionGuidanceOrderResponseIds([order]).map((id) => ({
        request: { method: "DELETE" as const, url: `QuestionnaireResponse/${id}` },
      })),
      { request: { method: "DELETE", url: `ServiceRequest/${srId}` } },
    ],
  });
};

export function useDeleteNutritionGuidanceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteNutritionGuidanceOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      // 指導目的のテンプレート記入内容も道連れで消えている。
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      invalidateAppointments(queryClient);
    },
  });
}

// ---- 栄養指導一覧(部門ワークリスト) ----
//
// 軸はリハビリ一覧と同じ。「基準日に効いている(始まっていて、まだ終わっていない)
// オーダー」を引き、終了日の判定はクライアントで行う。
//
// 指導形態・入外区分・病棟・診療科・進捗での絞り込みは画面側で行う
// (理由は api/queries/rad.ts の「放射線検査一覧」の節)。

/** 栄養指導一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface NutritionGuidanceWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 進捗(= 部門の受け入れ状態)。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** 基準日の実施記録。期間中は何度も指導するので「その日に実施したか」で見る。 */
  todayPerforms: NutritionGuidancePerformDisplay[];
  /** 基準日以降の予約(近い順)。先頭が「次回予約」。 */
  appointments: fhir4.Appointment[];
}

export interface NutritionGuidanceWorklistResult {
  rows: NutritionGuidanceWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

/**
 * 基準日に効いている栄養指導オーダーのヘッダ検索。worklistParams を使わないのは
 * 日付の当て方が違うため(他部門は実施予定日の一致、こちらは開始日 le + 終了判定)。
 */
function nutritionGuidanceWorklistParams(date: string, page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${NUTRITION_GUIDANCE_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, date, date);
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

/** 基準日 1 日ぶんの栄養指導の実施記録。オーダーの id ごとにまとめる。 */
async function fetchNutritionGuidancePerformsOn(
  date: string,
): Promise<Map<string, NutritionGuidancePerformDisplay[]>> {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${NUTRITION_GUIDANCE_ORDER_TYPE.code}`);
  params.set("date", date);

  const { matches } = await searchAllPages<fhir4.Procedure>("Procedure", params, { page: 500, maxPages: 4 });
  return nutritionGuidancePerformsByOrderId(matches);
}

/**
 * 基準日以降の栄養指導の予約を、オーダーの id ごとにまとめる(それぞれ日時の近い順)。
 * オーダー一覧の「次回予約」列と「本日の予約」ビューを 1 回の問い合わせで賄う。
 */
async function fetchNutritionGuidanceAppointmentsFrom(
  from: string,
): Promise<Map<string, fhir4.Appointment[]>> {
  const params = new URLSearchParams();
  params.set("date", `ge${from}`);
  params.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|nutrition-guidance`);
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

async function fetchNutritionGuidanceWorklist(
  date: string,
): Promise<NutritionGuidanceWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => nutritionGuidanceWorklistParams(date, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isNutritionGuidanceServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );

  // 実施記録はその日の分、予約は基準日以降の分だけが要るので別に引く。_revinclude だと
  // 継続中のオーダーの全期間ぶんが付いてくる。
  const [performsByOrderId, appointmentsByOrderId] = await Promise.all([
    fetchNutritionGuidancePerformsOn(date),
    fetchNutritionGuidanceAppointmentsFrom(date),
  ]);

  const taskByOrderId = nutritionGuidanceTasksByOrderId(tasks);

  const rows = orders
    .map((order) => ({
      order,
      patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
      task: taskByOrderId.get(order.id ?? ""),
      todayPerforms: performsByOrderId.get(order.id ?? "") ?? [],
      appointments: appointmentsByOrderId.get(order.id ?? "") ?? [],
    }));

  // 日単位の一覧では患者番号順が扱いやすい(リハビリ・病理と同じ)。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** 基準日に効いている栄養指導オーダー。日付が未選択の間は読みに行かない。 */
export function useNutritionGuidanceWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "nutrition-guidance-worklist", date],
    queryFn: () => fetchNutritionGuidanceWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/** 栄養指導の予約を取る。オーダーを basedOn に持つ Appointment + 枠の busy 化。 */
export function useBookNutritionGuidanceAppointment() {
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
    }) => postBundle(buildNutritionGuidanceAppointmentBundle(patient, selection, orderId)),
    onSuccess: () => {
      invalidateAppointments(queryClient);
      queryClient.invalidateQueries({
        queryKey: ["ServiceRequest", "nutrition-guidance-worklist"],
      });
    },
  });
}

// ---- 栄養指導の実施記録 ----
//
// 実施は Procedure を 1 件足すだけで進捗 Task を動かさない(リハビリと同じ逸脱。
// nutritionGuidanceResultHelpers.ts の冒頭コメント)。

/** 栄養指導の進捗・実施記録・予約が動いたときに読み直させるもの。 */
function invalidateNutritionGuidance(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "nutrition-guidance-worklist"] });
  // カルテのオーダーカードも進捗と実施履歴を出しているので読み直させる。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
  // パスから受付前に実施すると Task も受付済になる。患者の Task の一覧(パスの実施入力が読む)も読み直させる。
  queryClient.invalidateQueries({ queryKey: ["Task", "search"] });
}

/**
 * 実施登録。Procedure(+ 指導記録テンプレートの回答)を POST するだけで Task は
 * 動かさない。(他部門の useRegisterXxxPerform は Task を completed にする Bundle を
 * 受け取るが、栄養指導は期間中ずっと受付済のままなので、それに合わせてはいけない。)
 */
export function useRegisterNutritionGuidancePerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      invalidateNutritionGuidance(queryClient);
      // 指導記録テンプレートの回答も一緒に書いているので読み直させる。
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
    },
  });
}

/**
 * 実施の取消。Procedure と、紐付く指導記録テンプレートの回答をまとめて消す
 * (進捗は実施で動いていないので戻す先が無い)。
 */
export function useDeleteNutritionGuidancePerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (perform: { id: string; recordResponseId?: string }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: buildNutritionGuidancePerformDeleteEntries([perform]),
      }),
    onSuccess: () => {
      invalidateNutritionGuidance(queryClient);
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
    },
  });
}

/**
 * 受付・終了・中止などの進捗を書き込む。Task がまだ無いオーダーでは新しく作る。
 *
 * 「終了」だけは ServiceRequest にも終了日を書く。Task を completed にするだけでは
 * status=active のまま残り、部門一覧の `occurrence=le{基準日}` に永久にヒットし
 * 続けるため(docs/nutrition-guidance-order-design.md §3)。
 *
 * 逆に「終了取消」では終了日を消さない。打ち切った期間まで巻き戻すと、その間に
 * 積んだ実施記録との整合が取れなくなるため。期間を延ばしたいときはオーダーを編集する。
 */
export function useUpdateNutritionGuidanceTaskStatus() {
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
      status: NutritionGuidanceTaskStatus;
      endDate?: string;
    }) => {
      const entry: fhir4.BundleEntry[] = [
        taskBundleEntry(buildNutritionGuidanceTaskUpdate(task, order, status)),
      ];
      if (status === "completed" && endDate) {
        entry.push(buildNutritionGuidanceOrderCloseEntry(order, endDate));
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    onSuccess: () => invalidateNutritionGuidance(queryClient),
  });
}
