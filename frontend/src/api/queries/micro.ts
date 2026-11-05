import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { excludeNursingProblems } from "../../fhir/conditionHelpers";
import { observationIdsFromReport, specimenIdsFromReport } from "../../fhir/labResultHelpers";
import {
  buildMicroOrderDeleteBundle,
  isMicroServiceRequest,
  MICRO_ORDER_TYPE,
  microOrderItemRequests,
} from "../../fhir/microOrderHelpers";
import { buildMicroResultDeleteBundle, microOrderIdFromReport } from "../../fhir/microResultHelpers";
import {
  buildMicroTaskUpdate,
  microTasksByOrderId,
  microTaskStatus,
  microTaskStatusForReport,
  type MicroTaskStatus,
} from "../../fhir/microTaskHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { localDay } from "../../lib/dates";
import { transactionBundle } from "../../fhir/shared";
import {
  createResource,
  deleteResource,
  type FhirResult,
  postBundle,
  readHistory,
  readResource,
  searchResource,
  updateResource,
} from "../fhirClient";
import {
  hasRelation,
  HISTORY_COUNT,
  NOTIFICATION_TASK_KEY,
  resourcesOfType,
  saveWithImages,
  searchAllPages,
} from "./core";
import { useLabResultDetail } from "./labResult";
import { withResultReviewTask } from "./notification";
import { fetchDerivedObservationRefs } from "./patientProfile";
import {
  comparePatientNumber,
  deleteOrderWithItems,
  fetchWorklistBundles,
  makeUpdateTaskStatusHook,
  taskBundleEntry,
  worklistParams,
} from "./worklist";
import { invalidateOrderDependents } from "./orderDelete";

/** 細菌検査一覧のキャッシュのキー(["ServiceRequest", MICRO_WORKLIST_KEY, …])。 */
const MICRO_WORKLIST_KEY = "micro-worklist";

// ---- 細菌検査結果 ----

// 内容表示・編集の取得は検体検査結果と同じ形(_id + result / specimen の _include)。
export function useMicroResultDetail(reportId: string | undefined) {
  return useLabResultDetail(reportId);
}

// 細菌検査結果を保存・削除するとオーダーの紐付け状況が変わるため、
// 細菌検査オーダーの候補(["ServiceRequest", "search"] 配下)も無効化する。
// 保存では、結果の報告区分に合わせて部門の進捗(Task)も同じ transaction で進める
// (最終報告で報告済。fhir/microTaskHelpers.ts の microTaskStatusForReport)。
async function saveMicroResult(bundle: fhir4.Bundle) {
  return postBundle(
    await withMicroTaskProgress(await withResultReviewTask(bundle, "micro", microReviewSummary)),
  );
}

export function useCreateMicroResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveMicroResult,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", MICRO_WORKLIST_KEY] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

export function useUpdateMicroResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveMicroResult,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", MICRO_WORKLIST_KEY] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

/** Bundle の細菌検査結果が紐付くオーダーの進捗を、報告区分に合わせて書き足す。 */
async function withMicroTaskProgress(bundle: fhir4.Bundle): Promise<fhir4.Bundle> {
  const report = bundle.entry?.find((e) => e.resource?.resourceType === "DiagnosticReport")
    ?.resource as fhir4.DiagnosticReport | undefined;
  const orderId = microOrderIdFromReport(report);
  if (!report || !orderId) return bundle;
  const taskEntry = await microTaskEntryForReport(orderId, report.status);
  return taskEntry ? { ...bundle, entry: [...(bundle.entry ?? []), taskEntry] } : bundle;
}

/**
 * 結果の保存・削除に合わせた進捗の書き込み(変えなくてよければ undefined)。reportStatus は
 * 結果を消すとき null。オーダーと Task はその場で読み直す(読んだ Task の版は postBundle が
 * ifMatch に添える)。
 */
async function microTaskEntryForReport(
  orderId: string,
  reportStatus: string | null,
): Promise<fhir4.BundleEntry | undefined> {
  const params = new URLSearchParams();
  params.set("_id", orderId);
  params.set("_revinclude", "Task:focus");
  const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
  const order = resourcesOfType<fhir4.ServiceRequest>(bundle, "ServiceRequest").find(
    (request) => request.id === orderId,
  );
  if (!order) return undefined;
  const task = microTasksByOrderId(resourcesOfType<fhir4.Task>(bundle, "Task")).get(orderId);
  const next = microTaskStatusForReport(microTaskStatus(task), reportStatus);
  return next ? taskBundleEntry(buildMicroTaskUpdate(task, order, next)) : undefined;
}

/** 細菌検査の通知に出す要約。検体が何かで「どの検査の結果か」が分かる。 */
function microReviewSummary(report: fhir4.DiagnosticReport): string {
  return report.specimen?.[0]?.display ?? "";
}

/** 病理の通知に出す要約。検体(臓器・部位)を並べる。 */
export function pathoReviewSummary(report: fhir4.DiagnosticReport): string {
  const names = (report.specimen ?? [])
    .map((specimen) => specimen.display)
    .filter((name): name is string => Boolean(name));
  return names.length > 2 ? `${names.slice(0, 2).join("・")} ほか` : names.join("・");
}

export function useDeleteMicroResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: string) => {
      // 削除対象の Observation / Specimen は DiagnosticReport の参照から辿る。
      const { data: report } = await readResource<fhir4.DiagnosticReport>(
        "DiagnosticReport",
        reportId,
      );
      const deleteBundle = buildMicroResultDeleteBundle(
        reportId,
        observationIdsFromReport(report),
        specimenIdsFromReport(report),
      );
      // 報告済のオーダーは、結果が無くなるので受付済に戻す。
      const orderId = microOrderIdFromReport(report);
      const taskEntry = orderId ? await microTaskEntryForReport(orderId, null) : undefined;
      return postBundle(
        taskEntry ? { ...deleteBundle, entry: [...(deleteBundle.entry ?? []), taskEntry] } : deleteBundle,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", MICRO_WORKLIST_KEY] });
    },
  });
}

const CONDITION_COUNT = 20;

export function useConditionSearch(patientId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", String(CONDITION_COUNT));
  params.set("_offset", String(offset));
  // 開始日の降順(新しい順)。_sort のキーは検索パラメータ名 onset-date。
  params.set("_sort", "-onset-date");
  excludeNursingProblems(params);

  const query = useQuery({
    queryKey: ["Condition", "search", patientId, offset],
    queryFn: () => searchResource<fhir4.Condition>("Condition", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: CONDITION_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function useCondition(id: string | undefined) {
  return useQuery({
    queryKey: ["Condition", id],
    queryFn: () => readResource<fhir4.Condition>("Condition", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateCondition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (condition: fhir4.Condition) => createResource(condition),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Condition", "search"] });
    },
  });
}

export function useUpdateCondition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ condition, etag }: { condition: fhir4.Condition; etag: string }) =>
      updateResource(condition, etag),
    onSuccess: (result: FhirResult<fhir4.Condition>) => {
      queryClient.invalidateQueries({ queryKey: ["Condition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Condition", result.data.id] });
    },
  });
}

/** 病名の一括転帰・開始日の一括変更。書き換えた Condition をまとめて 1 つの transaction で PUT する。 */
export function useBulkUpdateConditions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conditions: fhir4.Condition[]) =>
      postBundle(
        transactionBundle(
          conditions.map((condition) => ({
            resource: condition,
            request: { method: "PUT", url: `Condition/${condition.id}` },
          })),
        ),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Condition"] });
    },
  });
}

export function useDeleteCondition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Condition", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Condition", "search"] });
    },
  });
}

// プロブレムリストの上限。1 患者の病名は高々数十件の想定なので 1 回の検索で足りる。
export const KARTE_CONDITION_COUNT = 100;

// カルテ画面のプロブレムリスト用。プロブレムと保険病名の振り分けは
// splitConditions() でクライアント側が行うため、ここでは患者の病名を全件取得する
// (上流 fhir-server は未知の検索パラメータを黙って無視して全件返すことがあり、
//  category での絞り込みをサーバーに任せられない)。
// クエリキーを ["Condition", "search", ...] 配下に置くことで、病名の登録・更新・
// 削除の invalidate がそのまま効き、プロブレムリストも自動で再取得される。
// 患者の保険・公費。レセコンが正本で、カルテからは登録しないので読み取りだけ。
// 使えなくなった保険も status=cancelled として残るため、期間や履歴を見せられる。
export function useCoverages(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("beneficiary", `Patient/${patientId}`);
  params.set("_count", "50");

  const query = useQuery({
    queryKey: ["coverages", patientId],
    queryFn: () => searchResource<fhir4.Coverage>("Coverage", params),
    enabled: Boolean(patientId),
  });

  const coverages =
    resourcesOfType<fhir4.Coverage>(query.data?.data, "Coverage");

  return { ...query, coverages };
}

const EMPTY_CONDITIONS: fhir4.Condition[] = [];

/** 活動中の病名(看護問題を除く)。薬剤の病名禁忌の照合に使う。 */
export function useActiveConditions(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("clinical-status", "active");
  excludeNursingProblems(params);

  // 禁忌の有無の判定に使うので、欠けた結果は使わない(complete)。
  const query = useQuery({
    queryKey: ["Condition", "search", "active", patientId],
    queryFn: () => searchAllPages<fhir4.Condition>("Condition", params, { page: 500, maxPages: 4, complete: true }),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });

  return { ...query, conditions: query.data?.matches ?? EMPTY_CONDITIONS };
}

export function useKarteConditions(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", String(KARTE_CONDITION_COUNT));
  params.set("_sort", "-onset-date");
  excludeNursingProblems(params);

  const query = useQuery({
    queryKey: ["Condition", "search", "karte", patientId],
    queryFn: () => searchResource<fhir4.Condition>("Condition", params),
    enabled: Boolean(patientId),
  });

  const conditions =
    resourcesOfType<fhir4.Condition>(query.data?.data, "Condition");

  return { ...query, conditions };
}

/**
 * 診療記録の版履歴。「いつ誰が何を直したか」を辿るために使う。
 * クエリキーを ["Composition", id] 配下に置き、更新の invalidate が効くようにする。
 */
export function useClinicalNoteHistory(id: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ["Composition", id, "history"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("_count", String(HISTORY_COUNT));
      const { data: bundle } = await readHistory<fhir4.Composition>(
        "Composition",
        id as string,
        params,
      );
      return bundle;
    },
    enabled: Boolean(id) && enabled,
  });

  return {
    ...query,
    // 上流の _history は新しい版から返す(回帰 spec で固定済み)。
    versions: resourcesOfType<fhir4.Composition>(query.data, "Composition"),
  };
}

export function useClinicalNote(id: string | undefined) {
  return useQuery({
    queryKey: ["Composition", id],
    queryFn: () => readResource<fhir4.Composition>("Composition", id as string),
    enabled: Boolean(id),
  });
}

/**
 * Bundle エントリのうち、既存の QuestionnaireResponse を書き換える/消すものの id。
 * その回答から前回生成した Observation は作り直し(または道連れ削除)の対象になる。
 * 新規記入(urn:uuid で POST)は前回の生成物を持たないので含まない。
 */
function refreshedResponseIds(entries: fhir4.BundleEntry[]): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    const method = entry.request?.method;
    if (method !== "PUT" && method !== "DELETE") continue;
    const id = entry.request?.url?.match(/^QuestionnaireResponse\/(.+)$/)?.[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** 上記の回答から前回生成した Observation を消す DELETE エントリ。 */
export async function staleObservationEntries(entries: fhir4.BundleEntry[]): Promise<fhir4.BundleEntry[]> {
  const refs = await fetchDerivedObservationRefs(refreshedResponseIds(entries));
  return refs.map((reference) => ({
    request: { method: "DELETE" as const, url: reference },
  }));
}

// entries はテンプレート記載の QuestionnaireResponse(とそのシェーマ画像 Binary、
// 回答から生成した Observation)。診療記録本体と同じ transaction Bundle で保存する
// — 先行 POST すると本体を保存しなかったときに QR だけが孤児として残るため
// (saveWithImages と同じ設計)。
//
// 記載を編集し直したときは、前回その回答から生成した Observation を消してから
// 作り直す(単独登録のテンプレート回答と同じ方式。項目と Observation を 1 対 1 で
// 対応付けて差分更新すると、テンプレート側のコード変更で対応が崩れる)。
export async function saveClinicalNote(
  composition: fhir4.Composition,
  entries: fhir4.BundleEntry[],
  etag?: string,
  fullUrl?: string,
): Promise<FhirResult<fhir4.Composition>> {
  const stale = await staleObservationEntries(entries);
  return saveWithImages(composition, [...stale, ...entries], etag, fullUrl);
}

export function useCreateClinicalNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      composition,
      entries,
      fullUrl,
    }: {
      composition: fhir4.Composition;
      entries: fhir4.BundleEntry[];
      /** 同じ transaction の entry(カウンターサインの通知)が新規の記録を指すための urn:uuid。 */
      fullUrl?: string;
    }) => saveClinicalNote(composition, entries, undefined, fullUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

export function useUpdateClinicalNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      composition,
      entries,
      etag,
    }: {
      composition: fhir4.Composition;
      entries: fhir4.BundleEntry[];
      etag: string;
    }) => saveClinicalNote(composition, entries, etag),
    onSuccess: (result: FhirResult<fhir4.Composition>) => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Composition", result.data.id] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

/** useDeleteMicroOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。 */
export const deleteMicroOrderRequest = (srId: string) =>
  deleteOrderWithItems(srId, {
    itemsOf: microOrderItemRequests,
    build: ({ srId, itemIds }) => buildMicroOrderDeleteBundle(srId, itemIds),
  });

export function useDeleteMicroOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMicroOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      invalidateOrderDependents(queryClient);
    },
  });
}

// ---- 細菌検査一覧(部門ワークリスト) ----
//
// 検査日(採取予定日)の範囲で細菌検査オーダーを読む。1 日ぶんの表示に加えて、培養に日数が
// かかる検査を追いかけるため、数日ぶんをまとめて読んで未完了だけを残す使い方もする。
// 入外区分・病棟・診療科・進捗での絞り込みは画面側で行う(理由は api/queries/rad.ts の
// 「放射線検査一覧」の節)。

/** 細菌検査一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface MicroWorklistRow {
  order: fhir4.ServiceRequest;
  /** 明細(検体グループ・検査項目)。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** このオーダーを元に登録済みの細菌検査結果の id。空なら結果はまだ無い。 */
  reportId: string;
  /** 結果の報告区分(preliminary / final)。 */
  reportStatus: string;
}

export interface MicroWorklistResult {
  rows: MicroWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

/** 読む検査日の範囲(両端を含む "YYYY-MM-DD")。1 日なら from と to が同じ。 */
export interface MicroWorklistRange {
  from: string;
  to: string;
}

async function fetchMicroWorklist(range: MicroWorklistRange): Promise<MicroWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];
  // オーダー id → そのオーダーを元にした細菌検査結果(id と報告区分)。
  const reportByOrderId = new Map<string, { id: string; status: string }>();

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(`${ORDER_TYPE_SYSTEM}|${MICRO_ORDER_TYPE.code}`, range.from, page);
      if (range.to !== range.from) {
        params.delete("occurrence");
        params.append("occurrence", `ge${range.from}`);
        params.append("occurrence", `le${range.to}`);
      }
      // 明細・進捗・結果も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "DiagnosticReport:based-on");
      return params;
    },
    (resource) => {
      if (resource.resourceType === "DiagnosticReport") {
        const report = resource as fhir4.DiagnosticReport;
        const orderId = microOrderIdFromReport(report);
        if (orderId && report.id) reportByOrderId.set(orderId, { id: report.id, status: report.status });
      } else if (resource.resourceType === "ServiceRequest") {
        const request = resource as fhir4.ServiceRequest;
        // 検索にヒットしたヘッダと、添えられた明細を分ける。
        if (isMicroServiceRequest(request) && !request.basedOn?.length) {
          orders.push(request);
          return true;
        }
        items.push(request);
      }
      return false;
    },
  );

  const taskByOrderId = microTasksByOrderId(tasks);

  const rows = orders.map((order) => {
    const report = reportByOrderId.get(order.id ?? "");
    return {
      order,
      itemRequests: microOrderItemRequests(items, order.id ?? ""),
      patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
      task: taskByOrderId.get(order.id ?? ""),
      reportId: report?.id ?? "",
      reportStatus: report?.status ?? "",
    };
  });

  // 数日ぶんを読んだときは古い検査日から(長く待っている検体が上に来る)、同じ日は患者番号順。
  rows.sort(
    (a, b) =>
      localDay(a.order.occurrenceDateTime).localeCompare(localDay(b.order.occurrenceDateTime)) ||
      comparePatientNumber(a, b),
  );

  return { rows, truncated };
}

/** 検査日の範囲の細菌検査オーダー。日付が未選択の間は読みに行かない。 */
export function useMicroWorklist(range: MicroWorklistRange) {
  return useQuery({
    queryKey: ["ServiceRequest", MICRO_WORKLIST_KEY, range.from, range.to],
    queryFn: () => fetchMicroWorklist(range),
    enabled: Boolean(range.from && range.to),
    placeholderData: keepPreviousData,
  });
}

/** 受付・中止などの進捗を書き込む(組み立ては makeUpdateTaskStatusHook を参照)。 */
export const useUpdateMicroTaskStatus = makeUpdateTaskStatusHook<MicroTaskStatus>(
  buildMicroTaskUpdate,
  MICRO_WORKLIST_KEY,
);
