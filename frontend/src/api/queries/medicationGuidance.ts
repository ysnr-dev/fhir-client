import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import {
  buildMedicationGuidanceOrderCloseEntry,
  isMedicationGuidanceServiceRequest,
  MEDICATION_GUIDANCE_ORDER_TYPE,
} from "../../fhir/medicationGuidanceOrderHelpers";
import {
  buildMedicationGuidanceAssignment,
  buildMedicationGuidanceTaskUpdate,
  medicationGuidanceTasksByOrderId,
  type MedicationGuidanceTaskStatus,
} from "../../fhir/medicationGuidanceTaskHelpers";
import {
  buildMedicationGuidancePerformDeleteEntries,
  medicationGuidancePerformsByOrderId,
  type MedicationGuidancePerformDisplay,
} from "../../fhir/medicationGuidanceResultHelpers";
import { postBundle } from "../fhirClient";
import {
  makeOrderDetailHook,
  ORDER_PERFORM_REVINCLUDES,
  searchAllPages,
  setOrderPeriod,
  type Truncatable,
  WORKLIST_PAGE,
} from "./core";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";
import { comparePatientNumber, fetchWorklistBundles, taskBundleEntry } from "./worklist";

// ---- 服薬指導オーダー(docs/medication-guidance-order-design.md) ----
//
// 栄養指導と同じ期間継続型。ヘッダ 1 本 + 進捗 Task + 実施記録(Procedure)。
// 予約は持たない(薬剤師が病棟で指導し、枠を押さえない)。

export const useMedicationGuidanceOrderDetail = makeOrderDetailHook<fhir4.Resource>(
  "medication-guidance-order",
  ORDER_PERFORM_REVINCLUDES,
);

/** その患者の有効な服薬指導オーダー。退院で打ち切る対象を選ぶのに使う。 */
export function usePatientMedicationGuidanceOrders(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${MEDICATION_GUIDANCE_ORDER_TYPE.code}`);
  params.set("status", "active");
  params.set("_sort", "-authoredon");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "medication-guidance-patient", patientId],
    queryFn: async () => {
      // 打ち切りの対象を取りこぼさないよう、ページを辿って全件読む。
      const { matches } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
        page: 500,
        maxPages: 4,
        complete: true,
      });
      return matches.filter(isMedicationGuidanceServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

export function useUpdateMedicationGuidanceOrder() {
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
 * オーダーを消す。明細・予約・テンプレート回答を持たないのでヘッダの DELETE だけ。
 * useDeleteMedicationGuidanceOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteMedicationGuidanceOrderRequest = (srId: string) =>
  postBundle({
    resourceType: "Bundle",
    type: "transaction",
    entry: [{ request: { method: "DELETE", url: `ServiceRequest/${srId}` } }],
  });

export function useDeleteMedicationGuidanceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMedicationGuidanceOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

// ---- 服薬指導一覧(部門ワークリスト) ----
//
// 軸は栄養指導一覧と同じ。基準日に効いている(始まっていて、まだ終わっていない)オーダーを並べ、
// 指導区分・入外区分・病棟・診療科・担当・進捗での絞り込みは画面側で行う。

export interface MedicationGuidanceWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 進捗(= 部門の受け入れ状態)。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** 基準日の実施記録。 */
  todayPerforms: MedicationGuidancePerformDisplay[];
}

export interface MedicationGuidanceWorklistResult {
  rows: MedicationGuidanceWorklistRow[];
  truncated: boolean;
}

function medicationGuidanceWorklistParams(date: string, page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${MEDICATION_GUIDANCE_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, date, date);
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

/** 基準日 1 日ぶんの実施記録。オーダーの id ごとにまとめる。 */
async function fetchMedicationGuidancePerformsOn(
  date: string,
): Promise<Truncatable<Map<string, MedicationGuidancePerformDisplay[]>>> {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${MEDICATION_GUIDANCE_ORDER_TYPE.code}`);
  params.set("date", date);
  const { matches, truncated } = await searchAllPages<fhir4.Procedure>("Procedure", params, {
    page: 500,
    maxPages: 4,
  });
  return { value: medicationGuidancePerformsByOrderId(matches), truncated };
}

async function fetchMedicationGuidanceWorklist(date: string): Promise<MedicationGuidanceWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => medicationGuidanceWorklistParams(date, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isMedicationGuidanceServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );

  // 実施記録はその日の分だけが要るので別に引く(_revinclude だと全期間ぶんが付いてくる)。
  const performs = await fetchMedicationGuidancePerformsOn(date);
  const taskByOrderId = medicationGuidanceTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
    todayPerforms: performs.value.get(order.id ?? "") ?? [],
  }));
  rows.sort(comparePatientNumber);

  return { rows, truncated: truncated || performs.truncated };
}

/** 基準日に効いている服薬指導オーダー。 */
export function useMedicationGuidanceWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "medication-guidance-worklist", date],
    queryFn: () => fetchMedicationGuidanceWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

// ---- 実施記録・進捗 ----

function invalidateMedicationGuidance(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "medication-guidance-worklist"] });
  // カルテのオーダーカードも進捗と実施履歴を出しているので読み直させる。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
  queryClient.invalidateQueries({ queryKey: ["Task", "search"] });
}

/** 実施登録。Procedure(+ 指導記録テンプレートの回答)を POST するだけで Task は動かさない。 */
export function useRegisterMedicationGuidancePerform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      invalidateMedicationGuidance(queryClient);
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
    },
  });
}

/** 実施の取消。Procedure と紐付く指導記録テンプレートの回答をまとめて消す。 */
export function useDeleteMedicationGuidancePerform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (perform: { id: string; recordResponseId?: string }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: buildMedicationGuidancePerformDeleteEntries([perform]),
      }),
    onSuccess: () => {
      invalidateMedicationGuidance(queryClient);
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
    },
  });
}

/**
 * 受付・終了・中止などの進捗を書き込む。Task がまだ無いオーダーでは新しく作る。
 * 「終了」だけは ServiceRequest にも終了日を書く(栄養指導と同じ)。
 */
export function useUpdateMedicationGuidanceTaskStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      order,
      task,
      status,
      endDate,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: MedicationGuidanceTaskStatus;
      /** 終了日。status が completed のときだけ使う。 */
      endDate?: string;
    }) => {
      const entry: fhir4.BundleEntry[] = [taskBundleEntry(buildMedicationGuidanceTaskUpdate(task, order, status))];
      if (status === "completed" && endDate) entry.push(buildMedicationGuidanceOrderCloseEntry(order, endDate));
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    onSuccess: () => invalidateMedicationGuidance(queryClient),
  });
}

/** 担当薬剤師の登録・解除(Task.owner)。Task がまだ無ければ今の状態のまま作る。 */
export function useAssignMedicationGuidancePharmacist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      order,
      task,
      pharmacist,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      pharmacist: { id: string; name: string } | null;
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [taskBundleEntry(buildMedicationGuidanceAssignment(task, order, pharmacist))],
      }),
    onSuccess: () => invalidateMedicationGuidance(queryClient),
  });
}
