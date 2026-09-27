import { useMemo } from "react";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { buildRxTaskUpdate, rxTasksByOrderId } from "../../fhir/rxTaskHelpers";
import { postBundle, readResource, searchResource } from "../fhirClient";
import { broughtMedicationEntry, isAwaitingDecision } from "../../fhir/broughtMedicationHelpers";
import {
  BROUGHT_MED_IDENTIFIED_TASK_CODE,
  BROUGHT_MED_REVIEW_TASK_CODE,
  broughtMedReviewEntry,
  buildBroughtMedReviewTask,
  isOpenBroughtMedReview,
} from "../../fhir/broughtMedTaskHelpers";
import { useOrderEnterer } from "./provenance";

// ---- 持参薬(MedicationStatement) ----
//
// 持参薬 1 剤 = MedicationStatement 1 件で、入院(context)ごとに引く。鑑別依頼と鑑別済の
// 通知は入院を焦点にした Task(docs/brought-medication-design.md)。

function statementsOf(bundle: fhir4.Bundle | undefined): fhir4.MedicationStatement[] {
  return (
    bundle?.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.MedicationStatement => r?.resourceType === "MedicationStatement") ?? []
  );
}

/** 登録の新しい順。上流の MedicationStatement は登録日時で並べ替えられないので手元で並べる。 */
function sortByAsserted(statements: fhir4.MedicationStatement[]): fhir4.MedicationStatement[] {
  return [...statements].sort((a, b) => (b.dateAsserted ?? "").localeCompare(a.dateAsserted ?? ""));
}

/**
 * 患者の持参薬。入院を渡すとその入院のものだけ。誤登録は除く。
 * 1 入院の持参薬は多くても数十剤なので、ページングせず 1 回で引く。
 */
export function usePatientBroughtMedications(
  patientId: string | undefined,
  encounterId?: string,
) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  if (encounterId) params.set("context", `Encounter/${encounterId}`);
  params.set("status:not", "entered-in-error");
  params.set("_count", "500");

  const query = useQuery({
    queryKey: ["MedicationStatement", "search", "patient", patientId, encounterId ?? null],
    queryFn: () => searchResource<fhir4.MedicationStatement>("MedicationStatement", params),
    enabled: Boolean(patientId),
  });
  const statements = useMemo(() => sortByAsserted(statementsOf(query.data?.data)), [query.data]);
  return { ...query, statements };
}

export function useBroughtMedication(id: string | undefined) {
  return useQuery({
    queryKey: ["MedicationStatement", "read", id],
    queryFn: async () =>
      (await readResource<fhir4.MedicationStatement>("MedicationStatement", id as string)).data,
    enabled: Boolean(id),
  });
}

/** id を指定して持参薬を引く(継続で処方フォームの初期値を作るとき)。 */
export function useBroughtMedicationsByIds(ids: string[] | undefined) {
  const key = (ids ?? []).join(",");
  const query = useQuery({
    queryKey: ["MedicationStatement", "search", "ids", key],
    queryFn: () =>
      searchResource<fhir4.MedicationStatement>(
        "MedicationStatement",
        new URLSearchParams({ _id: key, _count: "500" }),
      ),
    enabled: key !== "",
  });
  const statements = useMemo(() => {
    const byId = new Map(statementsOf(query.data?.data).map((s) => [s.id, s]));
    // 選んだ順(一覧の並び)を保つ。
    return (ids ?? [])
      .map((id) => byId.get(id))
      .filter((s): s is fhir4.MedicationStatement => Boolean(s));
  }, [query.data, ids]);
  return { ...query, statements };
}

/**
 * 重複チェックに数える持参薬(未鑑別・未判断)。継続したものは起こした処方の側で数える。
 */
export function useActiveBroughtMedications(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("status", "active");
  params.set("_count", "500");

  const query = useQuery({
    queryKey: ["MedicationStatement", "search", "active", patientId],
    queryFn: () => searchResource<fhir4.MedicationStatement>("MedicationStatement", params),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });
  const statements = useMemo(
    () => statementsOf(query.data?.data).filter(isAwaitingDecision),
    [query.data],
  );
  return { ...query, statements };
}

/** 入院の鑑別依頼と鑑別済の通知。 */
export function useBroughtMedTasks(encounterId: string | undefined) {
  const params = new URLSearchParams();
  params.set(
    "code",
    [BROUGHT_MED_REVIEW_TASK_CODE, BROUGHT_MED_IDENTIFIED_TASK_CODE]
      .map((code) => `${TASK_CODE_SYSTEM}|${code.code}`)
      .join(","),
  );
  if (encounterId) params.set("encounter", `Encounter/${encounterId}`);
  params.set("_count", "100");

  const query = useQuery({
    queryKey: ["Task", "search", "brought-med", encounterId],
    queryFn: () => searchResource<fhir4.Task>("Task", params),
    enabled: Boolean(encounterId),
  });
  const tasks = useMemo(
    () =>
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Task => r?.resourceType === "Task") ?? [],
    [query.data],
  );
  return { ...query, tasks };
}

function invalidateBroughtMedications(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["MedicationStatement"] });
  queryClient.invalidateQueries({ queryKey: ["Task"] });
}

/**
 * 持参薬の登録。入院の持参薬なら、閉じていない鑑別依頼が無いときだけ同じ transaction で作る
 * (鑑別済のあとに足した持参薬は新しい依頼になる)。
 */
export function useRegisterBroughtMedications() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: async ({
      statements,
      patientId,
      admission,
    }: {
      statements: fhir4.MedicationStatement[];
      patientId: string;
      admission?: { encounterId: string; wardName: string; admissionDate: string };
    }) => {
      const entry = statements.map((statement) => broughtMedicationEntry(statement));
      if (admission) {
        const params = new URLSearchParams({
          code: `${TASK_CODE_SYSTEM}|${BROUGHT_MED_REVIEW_TASK_CODE.code}`,
          encounter: `Encounter/${admission.encounterId}`,
          status: "requested,in-progress",
          _count: "10",
        });
        const existing = await searchResource<fhir4.Task>("Task", params);
        const open = existing.data.entry?.some(
          (e) => e.resource?.resourceType === "Task" && isOpenBroughtMedReview(e.resource),
        );
        if (!open) {
          entry.push(
            broughtMedReviewEntry(
              buildBroughtMedReviewTask({
                patientId,
                encounterId: admission.encounterId,
                wardName: admission.wardName,
                admissionDate: admission.admissionDate,
                ...(enterer ? { requester: enterer } : {}),
              }),
            ),
          );
        }
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    retry: false,
    onSuccess: () => invalidateBroughtMedications(queryClient),
  });
}

/**
 * 持参薬まわりの書き込み(鑑別・判断・取消・鑑別依頼の進捗)。組み立て済みの entry を
 * 1 つの transaction で送る。
 */
export function useBroughtMedicationTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entry: fhir4.BundleEntry[]) =>
      postBundle({ resourceType: "Bundle", type: "transaction", entry }),
    retry: false,
    onSuccess: () => {
      invalidateBroughtMedications(queryClient);
      // 継続を中止したときは起こした処方の進捗(Task)も書く。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

/**
 * 持参薬の判断(休止・中止)。継続していた持参薬を止めるときは、起こした処方(stopOrderIds)の
 * 調剤の進捗を中止にする更新も同じ transaction で送る(処方一覧の「中止」と同じ書き方)。
 */
export function useDecideBroughtMedications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entries,
      stopOrderIds,
    }: {
      entries: fhir4.BundleEntry[];
      stopOrderIds: string[];
    }) => {
      const entry = [...entries];
      if (stopOrderIds.length) {
        const result = await searchResource<fhir4.ServiceRequest>(
          "ServiceRequest",
          new URLSearchParams({ _id: stopOrderIds.join(","), _revinclude: "Task:focus" }),
        );
        const resources = (result.data.entry?.map((e) => e.resource) ?? []) as (
          | fhir4.Resource
          | undefined
        )[];
        const tasks = rxTasksByOrderId(
          resources.filter((r): r is fhir4.Task => r?.resourceType === "Task"),
        );
        for (const resource of resources) {
          if (resource?.resourceType !== "ServiceRequest" || !resource.id) continue;
          const order = resource as fhir4.ServiceRequest;
          const task = tasks.get(resource.id);
          if (task?.status === "cancelled") continue;
          const next = buildRxTaskUpdate(task, order, "cancelled");
          entry.push(
            task?.id
              ? { resource: next, request: { method: "PUT", url: `Task/${task.id}` } }
              : { resource: next, request: { method: "POST", url: "Task" } },
          );
        }
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    retry: false,
    onSuccess: () => {
      invalidateBroughtMedications(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

export interface BroughtMedWorklistItem {
  task: fhir4.Task;
  patient?: fhir4.Patient;
  statements: fhir4.MedicationStatement[];
}

/**
 * 薬剤部の鑑別一覧。鑑別依頼(Task)を引き、患者と入院を _include し、
 * 入院にぶら下がる持参薬を _revinclude:iterate で同じ 1 検索に添える。
 * 鑑別済も出すときは、依頼日がその日以降のものに絞る。
 */
export function useBroughtMedWorklist(options: { includeCompletedSince?: string }) {
  return useQuery({
    queryKey: ["Task", "search", "brought-med-worklist", options.includeCompletedSince ?? null],
    queryFn: async (): Promise<BroughtMedWorklistItem[]> => {
      const params = new URLSearchParams({
        code: `${TASK_CODE_SYSTEM}|${BROUGHT_MED_REVIEW_TASK_CODE.code}`,
        _sort: "authored-on",
        _count: "200",
      });
      params.append("_include", "Task:subject");
      params.append("_include", "Task:encounter");
      params.append("_revinclude:iterate", "MedicationStatement:context");
      if (options.includeCompletedSince) {
        params.set("status", "requested,in-progress,completed");
        params.set("authored-on", `ge${options.includeCompletedSince}`);
      } else {
        params.set("status", "requested,in-progress");
      }
      const taskBundle = await searchResource<fhir4.Task>("Task", params);
      const tasks: fhir4.Task[] = [];
      const patients = new Map<string, fhir4.Patient>();
      const statementsByEncounter = new Map<string, fhir4.MedicationStatement[]>();
      for (const e of taskBundle.data.entry ?? []) {
        const resource = e.resource as
          | fhir4.Task
          | fhir4.Patient
          | fhir4.MedicationStatement
          | undefined;
        if (resource?.resourceType === "Task") tasks.push(resource);
        else if (resource?.resourceType === "Patient" && resource.id) {
          patients.set(resource.id, resource);
        } else if (
          resource?.resourceType === "MedicationStatement" &&
          resource.status !== "entered-in-error"
        ) {
          const ref = resource.context?.reference ?? "";
          statementsByEncounter.set(ref, [...(statementsByEncounter.get(ref) ?? []), resource]);
        }
      }

      return tasks.map((task) => ({
        task,
        patient: patients.get(task.for?.reference?.split("/").pop() ?? ""),
        statements: sortByAsserted(statementsByEncounter.get(task.encounter?.reference ?? "") ?? []),
      }));
    },
  });
}
