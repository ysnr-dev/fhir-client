import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { buildNursingOrderRevokeEntry, isNursingServiceRequest, NURSING_ORDER_TYPE } from "../../fhir/nursingOrderHelpers";
import { type NursingPerformDisplay, nursingPerformsByOrderId } from "../../fhir/nursingPerformHelpers";
import {
  buildNursingTaskUpdate,
  isNursingTask,
  nursingTaskEntry,
  nursingTasksByOrderId,
  nursingTaskStatus,
  withTaskOwner,
} from "../../fhir/nursingTaskHelpers";
import { deleteResource, postBundle, searchResource } from "../fhirClient";
import { searchAllPages, setOrderPeriod, WORKLIST_PAGE } from "./core";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";
import { comparePatientNumber, fetchWorklistBundles } from "./worklist";

// ---- 看護指示(指示簿) ----
//
// 1 指示行 = 1 ServiceRequest で、指示受けの Task を _revinclude で一緒に引く。
// 「指定日に効いている」は order-period で引く(食事・リハビリと同じ)。

export interface NursingOrderSet {
  orders: fhir4.ServiceRequest[];
  tasks: fhir4.Task[];
}

export function nursingOrderSetOf(bundle: fhir4.Bundle | undefined): NursingOrderSet {
  const resources = (bundle?.entry ?? []).map((e) => e.resource).filter(Boolean) as fhir4.Resource[];
  return {
    orders: resources
      .filter((r): r is fhir4.ServiceRequest => r.resourceType === "ServiceRequest")
      .filter(isNursingServiceRequest),
    tasks: resources.filter((r): r is fhir4.Task => r.resourceType === "Task").filter(isNursingTask),
  };
}

export function nursingOrderParams(patientId: string | undefined, status?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${NURSING_ORDER_TYPE.code}`);
  if (status) params.set("status", status);
  params.set("_revinclude", "Task:focus");
  params.set("_sort", "-authoredon");
  params.set("_count", "200");
  return params;
}

/** 指定日に効いている看護指示(指示簿の「現在有効」)。 */
export function useActiveNursingOrders(patientId: string | undefined, at: string) {
  const params = nursingOrderParams(patientId, "active");
  setOrderPeriod(params, at, at);
  return useQuery({
    queryKey: ["ServiceRequest", "search", "nursing-active", patientId, at],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      return nursingOrderSetOf(bundle);
    },
    enabled: Boolean(patientId) && Boolean(at),
  });
}

/**
 * その患者の看護指示すべて(中止・終了を含む)。履歴ビューと退院時の打ち切りに使う。
 * 打ち切りの対象を取りこぼさないよう、ページを辿って全件読む。
 */
export function usePatientNursingOrders(patientId: string | undefined) {
  const params = nursingOrderParams(patientId);
  return useQuery({
    queryKey: ["ServiceRequest", "search", "nursing-patient", patientId],
    queryFn: async () => {
      const { bundles } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
        page: 500,
        maxPages: 4,
      });
      return nursingOrderSetOf({
        resourceType: "Bundle",
        type: "searchset",
        entry: bundles.flatMap((bundle) => bundle.entry ?? []),
      });
    },
    enabled: Boolean(patientId),
  });
}

export function useNursingOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) {
    params.set("_id", srId);
    params.set("_revinclude", "Task:focus");
  }
  return useQuery({
    queryKey: ["ServiceRequest", "detail", "nursing-order", srId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const set = nursingOrderSetOf(bundle);
      return { order: set.orders[0], task: set.tasks[0] };
    },
    enabled: Boolean(srId),
  });
}

export function invalidateNursing(queryClient: ReturnType<typeof useQueryClient>) {
  // 病棟の指示簿一覧(と入院患者一覧の未指示受けバッジ)も同じ Task を見ているので
  // 一緒に読み直させる。これが無いと指示受けしても一覧の状態が変わらない。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "nursing-worklist"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
}

export function useUpdateNursingOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      invalidateNursing(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/** 中止。指示を revoked にし、指示受け Task も cancelled にする。 */
export function useRevokeNursingOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ order, task }: { order: fhir4.ServiceRequest; task: fhir4.Task | undefined }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          buildNursingOrderRevokeEntry(order),
          nursingTaskEntry(buildNursingTaskUpdate(task, order, "cancelled")),
        ],
      }),
    onSuccess: () => invalidateNursing(queryClient),
  });
}

/** 指示受け。選んだ行の Task をまとめて accepted にし、受けた人を owner に入れる。 */
export function useAcceptNursingOrders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      rows,
      owner,
    }: {
      rows: { order: fhir4.ServiceRequest; task: fhir4.Task | undefined }[];
      owner: { practitionerId: string; display: string };
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: rows.map(({ order, task }) =>
          nursingTaskEntry(withTaskOwner(buildNursingTaskUpdate(task, order, "accepted"), owner)),
        ),
      }),
    onSuccess: () => invalidateNursing(queryClient),
  });
}

// ---- 病棟の指示簿(看護指示のワークリスト) ----
//
// 他の部門一覧と違い、依頼を受けるのが部門ではなく **病棟**。そのため絞り込みの主軸が
// 病棟で、しかも上流の ward 検索(オーダーに焼き付けた order-ward 拡張)で **サーバー側で**
// 絞る。看護指示は退院まで status=active のまま残り続ける(締め処理を持たない、
// docs/nursing-order-design.md §7)ので、全病院ぶんを引いてから捨てる作りにすると
// 際限なく重くなるため。他の絞り込み(診療科・指示受け状態)は他のワークリストと同じく
// 手元のデータに対して画面側で行う。
//
// 軸はリハビリ一覧と同じで、基準日に **効いている**(始まっていて、まだ終わっていない)
// 指示を order-period で引いて並べる。

/** 病棟の指示簿の 1 行。指示 1 件ぶん。 */
export interface NursingWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 指示受け。まだ誰も受けていなければ undefined(= 指示受け待ち)。 */
  task?: fhir4.Task;
}

export interface NursingWorklistResult {
  /** 患者番号順。 */
  rows: NursingWorklistRow[];
  /** 患者 id -> 未指示受けの件数。入院患者一覧のバッジと画面の見出しで使う。 */
  pendingByPatientId: Map<string, number>;
  truncated: boolean;
}

function nursingWorklistParams(
  date: string,
  wardId: string | undefined,
  page: number,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${NURSING_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, date, date);
  // 病棟はオーダー登録時に焼き付けた order-ward 拡張。上流の ward 検索で絞る。
  if (wardId) params.set("ward", `Location/${wardId}`);
  // 看護指示は 1 指示 = 1 ServiceRequest で basedOn を書かないので、他の部門一覧に
  // ある `based-on:missing=true`(明細を弾く)は要らない。
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

/** 未指示受けか(有効な指示で、まだ誰も受けていない)。 */
function isNursingPending(row: NursingWorklistRow): boolean {
  return row.order.status === "active" && nursingTaskStatus(row.task) === "requested";
}

async function fetchNursingWorklist(
  date: string,
  wardId: string | undefined,
): Promise<NursingWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => nursingWorklistParams(date, wardId, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isNursingServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );

  const taskByOrderId = nursingTasksByOrderId(tasks);

  const rows = orders
    .map((order) => ({
      order,
      patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
      task: taskByOrderId.get(order.id ?? ""),
    }));

  rows.sort(comparePatientNumber);

  // 「未指示受け」の数え方をここに閉じ込める(画面とバッジで食い違わせない)。
  const pendingByPatientId = new Map<string, number>();
  for (const row of rows) {
    if (!isNursingPending(row)) continue;
    const patientId = row.order.subject?.reference?.split("/").pop();
    if (!patientId) continue;
    pendingByPatientId.set(patientId, (pendingByPatientId.get(patientId) ?? 0) + 1);
  }

  return { rows, pendingByPatientId, truncated };
}

/**
 * 基準日に効いている看護指示(病棟ぶん)。病棟を選んでいないうちは読みに行かない
 * (病棟なしで引くと全病院ぶんになるため)。
 */
export function useNursingWorklist(date: string, wardId: string | undefined) {
  return useQuery({
    queryKey: ["ServiceRequest", "nursing-worklist", date, wardId ?? ""],
    queryFn: () => fetchNursingWorklist(date, wardId),
    enabled: Boolean(date) && Boolean(wardId),
    placeholderData: keepPreviousData,
  });
}

/**
 * 患者ごとの未指示受け件数(入院患者一覧のバッジ用)。中で useNursingWorklist を
 * 呼ぶだけなので、指示簿一覧と同じキャッシュに乗る(行き来してもリクエストは 1 回)。
 */
export function useNursingPendingCounts(date: string, wardId: string | undefined) {
  const query = useNursingWorklist(date, wardId);
  return {
    countByPatientId: query.data?.pendingByPatientId ?? new Map<string, number>(),
    error: query.error,
  };
}

// ---- 看護指示の実施記録 ----
//
// 観察は Observation、行為は Procedure(fhir/nursingPerformHelpers.ts)。どちらも
// category が order-type の nursing で、指示(ServiceRequest)を basedOn で指す。
// 患者・日付・指示のいずれかで引き、basedOn で指示に振り分ける。指示受けの Task は実施では動かない。

export function nursingPerformParams(): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${NURSING_ORDER_TYPE.code}`);
  params.set("_sort", "-date");
  params.set("_count", "200");
  return params;
}

export async function fetchNursingPerforms(
  setParams: (params: URLSearchParams) => void,
): Promise<Map<string, NursingPerformDisplay[]>> {
  const observationParams = nursingPerformParams();
  const procedureParams = nursingPerformParams();
  setParams(observationParams);
  setParams(procedureParams);
  // 実施記録の有無でパスの取消・指示の削除を止めるので、上限で切らずにページを辿る。
  const paging = { page: 500, maxPages: 4 };
  const [observations, procedures] = await Promise.all([
    searchAllPages<fhir4.Observation>("Observation", observationParams, paging),
    searchAllPages<fhir4.Procedure>("Procedure", procedureParams, paging),
  ]);
  return nursingPerformsByOrderId(observations.matches, procedures.matches);
}

/** その患者の実施記録(指示の id ごと、新しい順)。パスの画面が指示ごとの実施を見るのに使う。 */
export function useNursingPerformsOf(patientId: string | undefined) {
  return useQuery({
    // Procedure も含むが、無効化は Observation / Procedure の両方に投げるので片方のキーで足りる。
    queryKey: ["Observation", "search", "nursing-perform", patientId],
    queryFn: () =>
      fetchNursingPerforms((params) => params.set("patient", `Patient/${patientId}`)),
    enabled: Boolean(patientId),
  });
}

// 1 回の検索に載せる患者数。1 人 1 日の実施が 20 件を超えても _count(500)に収まる幅にする。
const NURSING_PERFORM_PATIENT_CHUNK = 20;

/**
 * 基準日 1 日ぶんの実施記録を、指示の id ごとにまとめる(病棟の指示簿の「本日」列)。
 * 画面の患者だけを、URL が長くなりすぎないよう分割して並列に引く。
 * 入院患者一覧のバッジ(useNursingPendingCounts)はこれを引かない(別クエリにしてある)。
 */
export function useNursingPerformsOn(date: string, patientIds: string[]) {
  const ids = [...new Set(patientIds)].sort();
  return useQuery({
    queryKey: ["Observation", "search", "nursing-perform-day", date, ids.join(",")],
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += NURSING_PERFORM_PATIENT_CHUNK) {
        chunks.push(ids.slice(i, i + NURSING_PERFORM_PATIENT_CHUNK));
      }
      const maps = await Promise.all(
        chunks.map((chunk) =>
          fetchNursingPerforms((params) => {
            params.set("date", date);
            params.set("patient", chunk.map((id) => `Patient/${id}`).join(","));
            params.set("_count", "500");
          }),
        ),
      );
      const byOrderId = new Map<string, NursingPerformDisplay[]>();
      for (const map of maps) {
        for (const [orderId, performs] of map) {
          byOrderId.set(orderId, [...(byOrderId.get(orderId) ?? []), ...performs]);
        }
      }
      return byOrderId;
    },
    enabled: Boolean(date) && ids.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** 1 つの指示の実施記録(新しい順)。指示の詳細の実施履歴に使う。 */
export function useNursingPerformsOfOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: ["Observation", "search", "nursing-perform-order", orderId],
    queryFn: async () => {
      const byOrderId = await fetchNursingPerforms((params) =>
        params.set("based-on", `ServiceRequest/${orderId}`),
      );
      return byOrderId.get(orderId ?? "") ?? [];
    },
    enabled: Boolean(orderId),
  });
}

function invalidateNursingPerforms(queryClient: QueryClient) {
  // 経過表のバイタル・実施履歴・本日列はどれも Observation の検索に乗っている。
  queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
  // 経過表の看護欄は指示と実施をまとめて 1 つのクエリにしてあり、キーが
  // ServiceRequest 側なので上の 2 つでは無効化されない。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search", "flowsheet-nursing"] });
}

/** 実施登録。Observation / Procedure を POST するだけで Task は動かさない。 */
export function useRegisterNursingPerform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateNursingPerforms(queryClient),
  });
}

/** 実施の取消。1 件消すだけ(進捗は実施で動いていないので戻す先が無い)。 */
export function useDeleteNursingPerform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ resourceType, id }: { resourceType: "Observation" | "Procedure"; id: string }) =>
      deleteResource(resourceType, id),
    onSuccess: () => invalidateNursingPerforms(queryClient),
  });
}
