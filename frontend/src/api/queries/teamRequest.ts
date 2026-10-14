import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { TEAM_ROUND_CATEGORY_SEARCH, compositionTeamRequestId } from "../../fhir/clinicalNoteHelpers";
import {
  buildTeamRequestDeleteBundle,
  buildTeamRequestRoundEntry,
  buildTeamRequestStatusEntry,
  TEAM_REQUEST_ORDER_TYPE,
  isTeamRequestServiceRequest,
  withTeamRequestNextRound,
} from "../../fhir/teamRequestHelpers";
import {
  buildTeamRequestTaskUpdate,
  teamRequestOrderStatusFor,
  teamRequestTasksByOrderId,
  teamRequestTaskStatus,
  type TeamRequestTaskStatus,
} from "../../fhir/teamRequestTaskHelpers";
import { postBundle, readResource, searchResource } from "../fhirClient";
import { WORKLIST_PAGE, resourcesOfType } from "./core";
import { staleObservationEntries } from "./micro";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";
import { fetchWorklistBundles, taskBundleEntry } from "./worklist";
import { invalidateOrderDependents, postOrderDeleteBundle } from "./orderDelete";

// ---- チーム依頼(docs/care-team-design.md §2〜§4) ----
//
// 他科依頼(consult.ts)と同じ「ヘッダ 1 本 + 進捗 Task」で、進捗の変更で ServiceRequest.status も一緒に動かす。
// 書き込みの入口は useUpdateTeamRequestTaskStatus・useSaveTeamRound・useSetTeamRequestNextRound の 3 つだけ。

export function useTeamRequestDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) {
    params.set("_id", srId);
    params.set("_revinclude", "Task:focus");
  }
  return useQuery({
    queryKey: ["ServiceRequest", "detail", "team-request", srId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

export function useUpdateTeamRequest() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      invalidateProvenance(queryClient);
    },
  });
}

/** 依頼を消す。介入中(受付済)・終了した依頼は、チームの記録がぶら下がるので消させない。 */
export const deleteTeamRequestRequest = async (srId: string) => {
  const params = new URLSearchParams();
  params.set("_id", srId);
  params.set("_revinclude", "Task:focus");
  const { data } = await searchResource<fhir4.Resource>("ServiceRequest", params);
  const order = resourcesOfType<fhir4.ServiceRequest>(data, "ServiceRequest").find((sr) => sr.id === srId);
  if (!order) {
    const { data: read } = await readResource<fhir4.ServiceRequest>("ServiceRequest", srId);
    return postOrderDeleteBundle(buildTeamRequestDeleteBundle(read));
  }
  const task = teamRequestTasksByOrderId(resourcesOfType<fhir4.Task>(data, "Task")).get(srId);
  const status = teamRequestTaskStatus(task);
  if (status === "accepted" || status === "completed") {
    throw new Error("受付済・終了したチーム依頼は削除できません。先にチーム依頼一覧で受付を取り消してください。");
  }
  return postOrderDeleteBundle(buildTeamRequestDeleteBundle(order));
};

export function useDeleteTeamRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTeamRequestRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      invalidateTeamRequest(queryClient);
      invalidateOrderDependents(queryClient);
    },
  });
}

// ---- チーム依頼一覧(ワークリスト) ----

/** 介入中(依頼済・介入中・却下)と終了。 */
export type TeamRequestWorklistView = "open" | "closed";

export interface TeamRequestWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  task?: fhir4.Task;
}

export interface TeamRequestWorklistResult {
  rows: TeamRequestWorklistRow[];
  truncated: boolean;
}

function teamRequestWorklistParams(view: TeamRequestWorklistView, teamId: string | undefined, page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${TEAM_REQUEST_ORDER_TYPE.code}`);
  if (view === "open") params.set("status", "active,revoked");
  else params.set("status", "completed");
  if (teamId) params.set("performer", `CareTeam/${teamId}`);
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_sort", "-authoredon");
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

async function fetchTeamRequestWorklist(
  view: TeamRequestWorklistView,
  teamId: string | undefined,
): Promise<TeamRequestWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => teamRequestWorklistParams(view, teamId, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isTeamRequestServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );
  const taskByOrderId = teamRequestTasksByOrderId(tasks);
  return {
    rows: orders.map((order) => ({
      order,
      patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
      task: taskByOrderId.get(order.id ?? ""),
    })),
    truncated,
  };
}

export function useTeamRequestWorklist(view: TeamRequestWorklistView, teamId?: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "team-request-worklist", view, teamId ?? ""],
    queryFn: () => fetchTeamRequestWorklist(view, teamId || undefined),
    placeholderData: keepPreviousData,
  });
}

/**
 * チームへの介入中の依頼(status=active)の患者 id。スクリーニング(データ抽出)の結果に
 * 「介入中」の印を出すのに使う。
 */
export function useTeamActiveRequestPatientIds(teamId: string | undefined) {
  return useQuery({
    queryKey: ["ServiceRequest", "team-request-active-patients", teamId ?? ""],
    queryFn: async () => {
      const result = await fetchTeamRequestWorklist("open", teamId);
      return new Set(
        result.rows.filter((row) => row.order.status === "active").map((row) => row.order.subject?.reference?.split("/").pop() ?? ""),
      );
    },
    enabled: Boolean(teamId),
  });
}

export function invalidateTeamRequest(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "team-request-worklist"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "team-request-active-patients"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
}

/** 進捗の変更。Task と ServiceRequest.status を 1 つの transaction で両方書く。却下は理由を添える。 */
export function useUpdateTeamRequestTaskStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      order,
      task,
      status,
      reason,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: TeamRequestTaskStatus;
      reason?: string;
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          taskBundleEntry(buildTeamRequestTaskUpdate(task, order, status, reason)),
          buildTeamRequestStatusEntry(order, teamRequestOrderStatusFor(status)),
        ],
      }),
    onSuccess: () => invalidateTeamRequest(queryClient),
  });
}

/** 次回回診日だけを書き換える。 */
export function useSetTeamRequestNextRound() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ order, date }: { order: fhir4.ServiceRequest; date: string }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          {
            resource: withTeamRequestNextRound(order, date),
            request: { method: "PUT", url: `ServiceRequest/${order.id}` },
          },
        ],
      }),
    onSuccess: () => invalidateTeamRequest(queryClient),
  });
}

/**
 * 回診記録の保存。診療記録(Composition)を書き、同じ transaction で依頼側に最後の回診と次回回診日を書く。
 * 依頼済のままなら介入中にする(回診したということは受けたということ)。
 */
export function useSaveTeamRound() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      order,
      task,
      composition,
      entries,
      roundDate,
      recorderName,
      nextRoundDate,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      composition: fhir4.Composition;
      entries: fhir4.BundleEntry[];
      roundDate: string;
      recorderName: string;
      nextRoundDate: string;
    }) => {
      const roundReference = `urn:uuid:${crypto.randomUUID()}`;
      const stale = await staleObservationEntries(entries);
      const status = teamRequestTaskStatus(task);
      const taskEntries =
        status === "requested" ? [taskBundleEntry(buildTeamRequestTaskUpdate(task, order, "accepted"))] : [];
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          ...stale,
          ...entries,
          { fullUrl: roundReference, resource: composition, request: { method: "POST", url: "Composition" } },
          ...taskEntries,
          buildTeamRequestRoundEntry(order, { roundReference, roundDate, recorderName, nextRoundDate }),
        ],
      });
    },
    onSuccess: () => {
      invalidateTeamRequest(queryClient);
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

/**
 * 依頼の回診記録(新しい順)。上流は Composition.event を索引していないので、患者の回診記録
 * (category = team-round)を引いて依頼で絞る(患者 1 人ぶんなので有限)。
 */
export function useTeamRounds(patientId: string | undefined, srId: string | undefined) {
  return useQuery({
    queryKey: ["Composition", "search", "team-round", patientId ?? "", srId ?? ""],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", TEAM_ROUND_CATEGORY_SEARCH);
      params.set("_sort", "-date");
      params.set("_count", "100");
      const { data } = await searchResource<fhir4.Composition>("Composition", params);
      return resourcesOfType<fhir4.Composition>(data, "Composition").filter((c) => compositionTeamRequestId(c) === srId);
    },
    enabled: Boolean(patientId) && Boolean(srId),
  });
}
