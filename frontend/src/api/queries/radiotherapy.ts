import {
  buildCompletedRadiotherapyReviewDueEntries,
  DEFAULT_RADIOTHERAPY_REVIEW,
  parseRadiotherapyReview,
  RADIOTHERAPY_REVIEW_DUE_TASK_CODE,
  type RadiotherapyReview,
  radiotherapyReviewDueEntry,
  radiotherapyReviewsByOrderId,
  type RadiotherapyReviewSettings,
  radiotherapyReviewState,
} from "../../fhir/radiotherapyReviewHelpers";
import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { today } from "../../lib/dates";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { serviceRequestsOf } from "../../fhir/labOrderHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { CONSULT_ORDER_TYPE, isConsultServiceRequest } from "../../fhir/consultOrderHelpers";
import {
  buildRadiotherapyOrderDeleteBundle,
  buildRadiotherapyOrderStatusEntry,
  isRadiotherapyServiceRequest,
  RADIOTHERAPY_ORDER_TYPE,
  type RadiotherapyTermination,
  summarizeRadiotherapyOrder,
} from "../../fhir/radiotherapyOrderHelpers";
import { COURSE_SUMMARY_KIND, radiotherapyCourseSummariesByOrderId } from "../../fhir/radiotherapySummaryHelpers";
import {
  buildRadiotherapyFractionCancelBundle,
  buildRadiotherapyFractionNotDoneBundle,
  buildRadiotherapyFractionRestoreBundle,
  isRadiotherapyFraction,
  PROCEDURE_KIND_SYSTEM,
  type RadiotherapyFractionDisplay,
  radiotherapyFractionsByOrderId,
  rescheduleRadiotherapyFraction,
} from "../../fhir/radiotherapyResultHelpers";
import {
  buildRadiotherapyTaskUpdate,
  radiotherapyOrderStatusFor,
  radiotherapyTasksByOrderId,
  radiotherapyTaskStatus,
  type RadiotherapyTaskStatus,
} from "../../fhir/radiotherapyTaskHelpers";
import { postBundle, readResource, searchResource } from "../fhirClient";
import {
  makeOrderDetailHook,
  NOTIFICATION_TASK_KEY,
  ORDER_PERFORM_REVINCLUDES,
  resourcesOfType,
  searchAllPages,
  WORKLIST_PAGE,
} from "./core";
import { useFacilitySettings } from "./organization";
import { invalidateProvenance, useOrderEnterer, useWithOrderProvenance } from "./provenance";
import { fetchWorklistBundles, taskBundleEntry } from "./worklist";

// ---- 放射線治療(治療処方) ----
//
// 明細を持たないヘッダ 1 本 + 進捗 Task で、作りは他科依頼と同じ。**進捗の変更で
// ServiceRequest.status も一緒に動かす**(docs/radiotherapy-order-design.md §4)。
// 書き込みの入口は useUpdateRadiotherapyTaskStatus だけ。

export const useRadiotherapyOrderDetail = makeOrderDetailHook<fhir4.Resource>("radiotherapy-order", ORDER_PERFORM_REVINCLUDES);

/**
 * その患者の放射線治療コース(進行中・終了・中止のすべて)。治療処方の安全確認
 * (過去の照射歴)とコース番号の既定値に使う。
 */
export function usePatientRadiotherapyOrders(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${RADIOTHERAPY_ORDER_TYPE.code}`);
  params.set("status", "active,on-hold,completed,revoked");
  params.set("_sort", "-authoredon");
  params.set("_count", "50");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "radiotherapy-patient", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      return serviceRequestsOf(bundle).filter(isRadiotherapyServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

/**
 * チャートのイベント帯に出す放射線治療。患者のコース(治療処方)と、その照射記録を
 * `_revinclude=Procedure:based-on` で 1 検索に揃える。
 */
export function usePatientRadiotherapyChart(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${RADIOTHERAPY_ORDER_TYPE.code}`);
  params.set("status", "active,on-hold,completed,revoked");
  params.set("_revinclude", "Procedure:based-on");
  params.set("_count", String(WORKLIST_PAGE));

  return useQuery({
    queryKey: ["ServiceRequest", "search", "radiotherapy-chart", patientId],
    queryFn: async (): Promise<{
      orders: fhir4.ServiceRequest[];
      fractions: Map<string, RadiotherapyFractionDisplay[]>;
    }> => {
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const orders = resourcesOfType<fhir4.ServiceRequest>(bundle, "ServiceRequest").filter(
        isRadiotherapyServiceRequest,
      );
      const procedures = resourcesOfType<fhir4.Procedure>(bundle, "Procedure").filter(
        (procedure) => procedure.status !== "entered-in-error" && isRadiotherapyFraction(procedure),
      );
      return { orders, fractions: radiotherapyFractionsByOrderId(procedures) };
    },
    enabled: Boolean(patientId),
  });
}

/**
 * その患者の他科依頼(新しい順)。治療処方が「どの依頼を受けたものか」を選ぶ候補。
 * 取消(revoked)は候補にしない。
 */
export function usePatientConsultOrders(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${CONSULT_ORDER_TYPE.code}`);
  params.set("status", "active,completed");
  params.set("based-on:missing", "true");
  params.set("_sort", "-authoredon");
  params.set("_count", "20");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "consult-patient", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      return serviceRequestsOf(bundle).filter(isConsultServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

function invalidateRadiotherapy(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "radiotherapy-worklist"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
  // 照射記録(部門一覧の回数と累積線量、カルテのカード)。
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
}

export function useUpdateRadiotherapyOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 治療処方を消す。**部門が受け付けた後(計画中以降)は消させない** — 計画や照射が
 * 進んでいる処方が消えると、何に基づいて照射したのかが辿れなくなる。受付後にやめる
 * ときは部門一覧の「中止」を使う(§4)。
 *
 * useDeleteRadiotherapyOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて
 * 消すときにも使う。
 */
export const deleteRadiotherapyOrderRequest = async (srId: string) => {
  const params = new URLSearchParams();
  params.set("_id", srId);
  params.set("_revinclude", "Task:focus");
  const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
  const tasks = resourcesOfType<fhir4.Task>(bundle, "Task");
  const status = radiotherapyTaskStatus(radiotherapyTasksByOrderId(tasks).get(srId));
  if (status !== "requested") {
    throw new Error(
      "受付後の放射線治療は削除できません。放射線治療一覧で中止するか、受付を取り消してください。",
    );
  }
  return postBundle(buildRadiotherapyOrderDeleteBundle(srId));
};

export function useDeleteRadiotherapyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRadiotherapyOrderRequest,
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

// ---- 放射線治療一覧(部門ワークリスト) ----
//
// 治療コースは数週間続くので、他科依頼と同じく日付ではなく status で切る(§4.1)。
//
//   進行中     … status=active(処方済・計画中・治療中)。いま抱えているコースなので有限。
//   終了・中止 … status=completed,revoked の直近ぶん(-authoredon)。

export type RadiotherapyWorklistView = "open" | "closed";

export interface RadiotherapyWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  task?: fhir4.Task;
}

export interface RadiotherapyWorklistResult {
  rows: RadiotherapyWorklistRow[];
  truncated: boolean;
}

function radiotherapyWorklistParams(view: RadiotherapyWorklistView, page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${RADIOTHERAPY_ORDER_TYPE.code}`);
  params.set("status", view === "open" ? "active,on-hold" : "completed,revoked");
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_sort", "-authoredon");
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

async function fetchRadiotherapyWorklist(
  view: RadiotherapyWorklistView,
): Promise<RadiotherapyWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => radiotherapyWorklistParams(view, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isRadiotherapyServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );

  const taskByOrderId = radiotherapyTasksByOrderId(tasks);
  const rows = orders.map((order) => ({
    order,
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  return { rows, truncated };
}

export function useRadiotherapyWorklist(view: RadiotherapyWorklistView) {
  return useQuery({
    queryKey: ["ServiceRequest", "radiotherapy-worklist", view],
    queryFn: () => fetchRadiotherapyWorklist(view),
    placeholderData: keepPreviousData,
  });
}

/**
 * 進捗の変更。Task と ServiceRequest.status を 1 つの transaction で両方書く(§4)。
 * **片方だけを書く入口を増やさないこと** — status だけが取り残されると、終了した
 * コースが部門一覧の進行中に出続ける。終了・中止では終了日と理由も同じ PUT で書く。
 */
export function useUpdateRadiotherapyTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      order,
      task,
      status,
      termination,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: RadiotherapyTaskStatus;
      termination?: RadiotherapyTermination;
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          taskBundleEntry(buildRadiotherapyTaskUpdate(task, order, status)),
          buildRadiotherapyOrderStatusEntry(order, radiotherapyOrderStatusFor(status), termination),
        ],
      }),
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

// ---- 照射記録(docs/radiotherapy-order-design.md §6.1) ----
//
// 1 回の照射 = Procedure 1 件。リハビリと同じく**照射しても進捗 Task は動かさない**ので、
// 登録は Procedure を 1 件 POST するだけ。取消は消さずに entered-in-error にする
// (照射録は保存の対象)。

/** そのコースの未対応の診察督促(通知 Task)。作り直しの抑止と、書いたときに閉じるのに使う。 */
async function fetchRadiotherapyReviewDueTasks(orderSrId: string): Promise<fhir4.Task[]> {
  const params = new URLSearchParams();
  params.set("code", `${TASK_CODE_SYSTEM}|${RADIOTHERAPY_REVIEW_DUE_TASK_CODE.code}`);
  params.set("focus", `ServiceRequest/${orderSrId}`);
  params.set("status", "requested");
  params.set("_count", "10");
  const { data: bundle } = await searchResource<fhir4.Task>("Task", params);
  return resourcesOfType<fhir4.Task>(bundle, "Task");
}

/**
 * 照射記録の登録。**診察が空いていれば同じ transaction で督促の通知を作る**(§6.3)。
 * 照射は治療中ほぼ毎日あるので、間隔を超えたことに最初に気づける場所がここになる。
 * 既に未対応の督促があるコースでは作らない(毎回の照射で作り直さない)。
 */
export function useRegisterRadiotherapyFraction() {
  const queryClient = useQueryClient();
  const facility = useFacilitySettings();
  const settings = facility.data?.radiotherapy_review ?? DEFAULT_RADIOTHERAPY_REVIEW;

  return useMutation({
    mutationFn: async ({ bundle, order }: { bundle: fhir4.Bundle; order: fhir4.ServiceRequest }) => {
      const due = await radiotherapyReviewDueEntryFor(order, settings);
      return postBundle(due ? { ...bundle, entry: [...(bundle.entry ?? []), due] } : bundle);
    },
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

async function radiotherapyReviewDueEntryFor(
  order: fhir4.ServiceRequest,
  settings: RadiotherapyReviewSettings,
): Promise<fhir4.BundleEntry | null> {
  const patientId = order.subject?.reference?.split("/").pop() ?? "";
  if (!order.id || !patientId) return null;

  const [reviews, tasks] = await Promise.all([
    fetchRadiotherapyReviewChunk([order.id]),
    fetchRadiotherapyReviewDueTasks(order.id),
  ]);
  if (tasks.length > 0) return null;

  const summary = summarizeRadiotherapyOrder(order);
  return radiotherapyReviewDueEntry({
    order,
    patientId,
    courseLabel: `第${summary.courseNumber}コース ${summary.siteLabel}`.trim(),
    state: radiotherapyReviewState(reviews, today(), settings),
    settings,
  });
}

/** 診察を書いたときに、そのコースの督促を閉じる。 */
export function useCloseRadiotherapyReviewDue() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();

  return useMutation({
    mutationFn: async (orderSrId: string) => {
      if (!enterer) return null;
      const tasks = await fetchRadiotherapyReviewDueTasks(orderSrId);
      const entries = buildCompletedRadiotherapyReviewDueEntries(tasks, enterer);
      if (entries.length === 0) return null;
      return postBundle({ resourceType: "Bundle", type: "transaction", entry: entries });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

export function useCancelRadiotherapyFraction() {
  const queryClient = useQueryClient();

  return useMutation({
    // 取り消す前に読み直すのは、PUT が全置換なので手元の写しでは古い版を書き戻しうるため。
    mutationFn: async (procedureId: string) => {
      const { data: procedure } = await readResource<fhir4.Procedure>("Procedure", procedureId);
      return postBundle(buildRadiotherapyFractionCancelBundle(procedure));
    },
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

/** 1 リクエストでまとめて引くコースの数(based-on のカンマ OR。URL 長と上流の索引の都合)。 */
const RADIOTHERAPY_COURSE_CHUNK = 20;

/** 1 コース = 予定と実績で数十件。20 コースぶんはこのページ数に収まる。 */
const RADIOTHERAPY_PROCEDURE_MAX_PAGES = 5;

export interface RadiotherapyProcedures {
  /** オーダー id → 照射記録(新しい順)。 */
  fractions: Map<string, RadiotherapyFractionDisplay[]>;
  /** オーダー id → 治療終了サマリー(1 コースに 1 件)。 */
  summaries: Map<string, fhir4.Procedure>;
}

/** 治療処方 id をまとめて指定して、その配下の照射記録・サマリーを引く。 */
async function fetchRadiotherapyProcedureChunk(orderIds: string[]): Promise<fhir4.Procedure[]> {
  const params = new URLSearchParams();
  params.set("based-on", orderIds.map((id) => `ServiceRequest/${id}`).join(","));
  params.set("category", `${ORDER_TYPE_SYSTEM}|${RADIOTHERAPY_ORDER_TYPE.code}`);
  params.set("status:not", "entered-in-error");
  params.set("_sort", "-date");
  const { matches } = await searchAllPages<fhir4.Procedure>("Procedure", params, {
    page: WORKLIST_PAGE,
    maxPages: RADIOTHERAPY_PROCEDURE_MAX_PAGES,
  });
  return matches;
}

/**
 * 画面に出ているコースの照射記録と治療終了サマリー。**治療処方の id で絞って引く**
 * (§8)。category だけで引くと終了したコースのぶんまで読むので、コースが増えるほど
 * 重くなり、上限に当たると回数と累積線量が静かに欠ける。
 */
async function fetchRadiotherapyProcedures(orderIds: string[]): Promise<RadiotherapyProcedures> {
  const chunks: string[][] = [];
  for (let i = 0; i < orderIds.length; i += RADIOTHERAPY_COURSE_CHUNK) {
    chunks.push(orderIds.slice(i, i + RADIOTHERAPY_COURSE_CHUNK));
  }
  const procedures = (await Promise.all(chunks.map(fetchRadiotherapyProcedureChunk))).flat();
  return {
    fractions: radiotherapyFractionsByOrderId(procedures.filter(isRadiotherapyFraction)),
    summaries: radiotherapyCourseSummariesByOrderId(procedures),
  };
}

/**
 * 引くのは呼び出し側が渡したコースだけ。右のパネルの行・空き枠に出すコース・格子に
 * 出ている照射のコースを合わせて渡す(格子の予定から実施入力を開けるので、行に無い
 * コースも要る)。
 */
export function useRadiotherapyProcedures(orderIds: string[]) {
  const ids = [...new Set(orderIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["Procedure", "search", "radiotherapy-procedures", ids.join(",")],
    queryFn: () => fetchRadiotherapyProcedures(ids),
    enabled: ids.length > 0,
  });
}

/**
 * 1 コースぶんの照射記録。何回目・どの Phase かを数えるモーダル(実施入力・一括登録・
 * サマリー)は、一覧のキャッシュではなく開いた時点で引き直す —— 一括登録の直後に続けて
 * 実施入力を開くような場面で、採番が古い写しに引きずられないように。
 */
export function useRadiotherapyCourseFractions(orderId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "search", "radiotherapy-course", orderId],
    queryFn: async () => {
      const procedures = await fetchRadiotherapyProcedureChunk([orderId ?? ""]);
      const byOrderId = radiotherapyFractionsByOrderId(procedures.filter(isRadiotherapyFraction));
      return byOrderId.get(orderId ?? "") ?? [];
    },
    enabled: Boolean(orderId),
  });
}

// ---- 治療中の診察(週次レビュー。docs/radiotherapy-order-design.md §6.3) ----
//
// 診察 1 回 = テンプレート回答 1 件で、治療処方を basedOn に持つ。上流は
// `QuestionnaireResponse?based-on=` に対応している。保存は通常のテンプレート回答と同じ経路
// (`useCreateQuestionnaireResponse`)なので、ここにあるのは読みだけ。

/** 照射記録と同じ理由でコースをまとめて引く(§7.3)。 */
const RADIOTHERAPY_REVIEW_CHUNK = 20;

async function fetchRadiotherapyReviewChunk(orderIds: string[]): Promise<RadiotherapyReview[]> {
  const params = new URLSearchParams();
  params.set("based-on", orderIds.map((id) => `ServiceRequest/${id}`).join(","));
  params.set("_count", "200");
  params.set("_sort", "-authored");
  const { data: bundle } = await searchResource<fhir4.QuestionnaireResponse>(
    "QuestionnaireResponse",
    params,
  );
  return resourcesOfType<fhir4.QuestionnaireResponse>(bundle, "QuestionnaireResponse")
    .map(parseRadiotherapyReview)
    .filter((review): review is RadiotherapyReview => review !== null);
}

/** あるコースの診察(新しい順)。カルテの右ペインと詳細で使う。 */
export function useRadiotherapyCourseReviews(orderSrId: string | undefined) {
  return useQuery({
    queryKey: ["QuestionnaireResponse", "search", "radiotherapy-review", orderSrId],
    queryFn: () => fetchRadiotherapyReviewChunk([orderSrId ?? ""]),
    enabled: Boolean(orderSrId),
  });
}

/** 部門一覧に出すコースの診察。オーダー id → 診察(新しい順)。 */
export function useRadiotherapyReviews(orderIds: string[]) {
  const ids = [...new Set(orderIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["QuestionnaireResponse", "search", "radiotherapy-reviews", ids.join(",")],
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += RADIOTHERAPY_REVIEW_CHUNK) {
        chunks.push(ids.slice(i, i + RADIOTHERAPY_REVIEW_CHUNK));
      }
      const reviews = (await Promise.all(chunks.map(fetchRadiotherapyReviewChunk))).flat();
      return radiotherapyReviewsByOrderId(reviews);
    },
    enabled: ids.length > 0,
  });
}

/** 治療終了サマリーの保存。初回は POST、書き直しは同じ Procedure への PUT。 */
export function useSaveRadiotherapyCourseSummary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

// ---- 放射線治療カレンダー(docs/radiotherapy-order-design.md §7) ----
//
// 格子に載せるのは照射の Procedure(予定・実績・未実施)。期間を date で切り、患者と治療処方を
// _include で一緒に取る。コースの一覧(右のパネル)は部門一覧と同じ useRadiotherapyWorklist。

export interface RadiotherapyCalendarEntry {
  fraction: RadiotherapyFractionDisplay;
  order?: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
}

async function fetchRadiotherapyCalendar(from: string, to: string): Promise<RadiotherapyCalendarEntry[]> {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${RADIOTHERAPY_ORDER_TYPE.code}`);
  // 治療終了サマリーは同じ category に種別の coding を足して区別する。格子に載せるのは照射だけ。
  params.set("category:not", `${PROCEDURE_KIND_SYSTEM}|${COURSE_SUMMARY_KIND.code}`);
  params.set("status:not", "entered-in-error");
  params.append("date", `ge${from}`);
  params.append("date", `le${to}`);
  params.append("_include", "Procedure:subject");
  params.append("_include", "Procedure:based-on");

  const { matches, bundles } = await searchAllPages<fhir4.Procedure>("Procedure", params, {
    page: WORKLIST_PAGE,
    maxPages: RADIOTHERAPY_PROCEDURE_MAX_PAGES,
  });
  const procedures = matches.filter(isRadiotherapyFraction);
  const patients = new Map(
    bundles
      .flatMap((bundle) => resourcesOfType<fhir4.Patient>(bundle, "Patient"))
      .map((patient) => [patient.id ?? "", patient]),
  );
  const orders = new Map(
    bundles
      .flatMap((bundle) => resourcesOfType<fhir4.ServiceRequest>(bundle, "ServiceRequest"))
      .map((sr) => [sr.id ?? "", sr]),
  );

  const entries: RadiotherapyCalendarEntry[] = [];
  for (const [orderId, fractions] of radiotherapyFractionsByOrderId(procedures)) {
    const order = orders.get(orderId);
    const patient = patients.get(order?.subject?.reference?.split("/").pop() ?? "");
    for (const fraction of fractions) entries.push({ fraction, order, patient });
  }
  return entries;
}

export function useRadiotherapyCalendar(from: string, to: string) {
  return useQuery({
    queryKey: ["Procedure", "search", "radiotherapy-calendar", from, to],
    queryFn: () => fetchRadiotherapyCalendar(from, to),
    placeholderData: keepPreviousData,
  });
}

/** 照射予定の一括登録(処方の回数ぶんの Procedure を 1 つの transaction で作る)。 */
export function useRegisterRadiotherapyPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

/** 照射予定の日時・装置の変更。読み直してから PUT する(全置換なので古い版を書き戻さない)。 */
export function useRescheduleRadiotherapyFraction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      procedureId,
      ...change
    }: {
      procedureId: string;
      date: string;
      startTime: string;
      endTime: string;
      device?: { code: string; name: string };
    }) => {
      const { data: procedure } = await readResource<fhir4.Procedure>("Procedure", procedureId);
      if (procedure.status !== "preparation") {
        throw new Error("照射済みの記録の日時は変更できません。");
      }
      const next = rescheduleRadiotherapyFraction(procedure, change);
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [{ resource: next, request: { method: "PUT", url: `Procedure/${procedureId}` } }],
      });
    },
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

/**
 * 照射予定の削除。**予定(preparation)は照射録ではない**ので物理削除でよい
 * (照射した記録の取消は entered-in-error。useCancelRadiotherapyFraction)。
 */
export function useDeleteRadiotherapyPlanned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (procedureIds: string[]) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: procedureIds.map((id) => ({
          request: { method: "DELETE" as const, url: `Procedure/${id}` },
        })),
      }),
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

/**
 * 照射予定を「照射しなかった回」にする(体調不良・休診など)。実施の入力とは別の操作で、
 * 線量も実施者も持たない(docs/radiotherapy-order-design.md §6.1)。
 */
export function useMarkRadiotherapyFractionNotDone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      procedureId,
      reason,
      note,
    }: {
      procedureId: string;
      reason: { code: string; name: string };
      note: string;
    }) => {
      // PUT は全置換なので、手元の写しではなく読み直したものを土台にする。
      const { data: procedure } = await readResource<fhir4.Procedure>("Procedure", procedureId);
      if (procedure.status !== "preparation") {
        throw new Error("照射予定だけを中止にできます(実施済みの記録は取消してください)。");
      }
      return postBundle(buildRadiotherapyFractionNotDoneBundle(procedure, reason, note));
    },
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

/** 中止を取り消して予定に戻す。 */
export function useRestoreRadiotherapyFraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (procedureId: string) => {
      const { data: procedure } = await readResource<fhir4.Procedure>("Procedure", procedureId);
      if (procedure.status !== "not-done") {
        throw new Error("中止した回だけを予定に戻せます。");
      }
      return postBundle(buildRadiotherapyFractionRestoreBundle(procedure));
    },
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}
