import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isLabelSpecimen } from "../../fhir/labResultHelpers";
import { injectionTasksByOrderId } from "../../fhir/injectionTaskHelpers";
import { INJECTION_ORDER_TYPE, isInjectionServiceRequest } from "../../fhir/injectionHelpers";
import { labOrderItemRequests } from "../../fhir/labOrderHelpers";
import {
  type ArrivalRecorder,
  buildSpecimenArrival,
  buildSpecimenArrivalCancel,
  LAB_LABEL_NUMBER_SYSTEM,
  labelSpecimensByOrderId,
} from "../../fhir/labSpecimenHelpers";
import { buildLabTaskUpdate, labTasksByOrderId, type LabTaskStatus } from "../../fhir/labTaskHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { buildRxTaskUpdate, type RxTaskStatus } from "../../fhir/rxTaskHelpers";
import { DEFAULT_IDENTIFIER_SYSTEM } from "../../fhir/patientHelpers";
import { postBundle, searchResource } from "../fhirClient";
import { fetchRxWorklist } from "./prescription";
import { comparePatientNumber, fetchWorklistBundles, makeUpdateTaskStatusHook, worklistParams } from "./worklist";

// ---- 注射一覧(部門ワークリスト) ----
//
// 注射日(occurrence)で 1 日ぶんの注射オーダーを読む。注射は 1 日 1 オーダー(連日は
// 日ごとに展開済み)なので、注射日で引けばその日の施用ぶんがそのまま並ぶ。
// 残りの絞り込みは画面側(理由は useRxWorklist と同じ)。

export interface InjectionWorklistRow {
  order: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
}

async function fetchInjectionWorklist(date: string): Promise<RxWorklistResultLike<InjectionWorklistRow>> {
  const orders: fhir4.ServiceRequest[] = [];
  const medicationRequests: fhir4.MedicationRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(`${ORDER_TYPE_SYSTEM}|${INJECTION_ORDER_TYPE.code}`, date, page);
      params.set("_revinclude", "MedicationRequest:based-on");
      params.append("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType === "MedicationRequest") {
        medicationRequests.push(resource as fhir4.MedicationRequest);
      } else if (resource.resourceType === "ServiceRequest") {
        const request = resource as fhir4.ServiceRequest;
        if (isInjectionServiceRequest(request)) {
          orders.push(request);
          return true;
        }
      }
      return false;
    },
  );

  const taskByOrderId = injectionTasksByOrderId(tasks);
  const mrsByOrderId = new Map<string, fhir4.MedicationRequest[]>();
  for (const mr of medicationRequests) {
    for (const reference of mr.basedOn ?? []) {
      const orderId = reference.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
      if (!orderId) continue;
      const list = mrsByOrderId.get(orderId);
      if (list) list.push(mr);
      else mrsByOrderId.set(orderId, [mr]);
    }
  }

  const rows = orders.map((order) => ({
    order,
    medicationRequests: mrsByOrderId.get(order.id ?? "") ?? [],
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));
  rows.sort(comparePatientNumber);
  return { rows, truncated };
}

interface RxWorklistResultLike<Row> {
  rows: Row[];
  truncated: boolean;
}

/** 注射日 1 日ぶんの注射オーダー。日付が未選択の間は読みに行かない。 */
export function useInjectionWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "injection-worklist", date],
    queryFn: () => fetchInjectionWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/**
 * 注射の払出登録。払出結果(MedicationDispense)と払出済の Task を 1 つの transaction で
 * 書き込む。Bundle の組み立ては injectionDispenseHelpers を参照。
 */
export function useRegisterInjectionDispense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "injection-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

/** 処方日 1 日ぶんの処方オーダー。日付が未選択の間は読みに行かない。 */
export function useRxWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "rx-worklist", date],
    queryFn: () => fetchRxWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/** 処方箋発行などの進捗を書き込む(組み立ては makeUpdateTaskStatusHook を参照)。 */
export const useUpdateRxTaskStatus = makeUpdateTaskStatusHook<RxTaskStatus>(
  buildRxTaskUpdate,
  "rx-worklist",
);

/**
 * 調剤登録。調剤結果(MedicationDispense)と調剤済の Task を 1 つの transaction で
 * 書き込む。Bundle の組み立ては rxDispenseHelpers を参照。
 */
export function useRegisterRxDispense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rx-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["MedicationDispense"] });
    },
  });
}

/**
 * 検体到着確認のための 1 オーダーぶんの文脈。スキャンした番号の逆引き結果
 * (order id)から、患者・検査項目・進捗を 1 リクエストで揃える
 * (docs/lab-arrival-design.md §4-1)。
 */
export interface LabArrivalContext {
  order: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  task?: fhir4.Task;
  /** 管(ラベル発行が作った Specimen)。到着の揃い判定に使う。 */
  specimens: fhir4.Specimen[];
  /** このオーダーに紐付いている検査結果の id。空なら結果がまだ無い。 */
  reportId: string;
}

export async function fetchLabArrivalContext(orderId: string): Promise<LabArrivalContext | null> {
  const params = new URLSearchParams();
  params.set("_id", orderId);
  params.set("_count", "100");
  params.set("_revinclude:iterate", "ServiceRequest:based-on");
  params.append("_revinclude", "Task:focus");
  params.append("_revinclude", "Specimen:request");
  params.append("_revinclude", "DiagnosticReport:based-on");
  params.set("_include", "ServiceRequest:subject");

  const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);

  let order: fhir4.ServiceRequest | undefined;
  const items: fhir4.ServiceRequest[] = [];
  const tasks: fhir4.Task[] = [];
  const specimens: fhir4.Specimen[] = [];
  let patient: fhir4.Patient | undefined;
  let reportId = "";
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (!resource) continue;
    if (resource.resourceType === "Patient") patient = resource as fhir4.Patient;
    else if (resource.resourceType === "Task") tasks.push(resource as fhir4.Task);
    else if (resource.resourceType === "Specimen") specimens.push(resource as fhir4.Specimen);
    else if (resource.resourceType === "DiagnosticReport") reportId ||= resource.id ?? "";
    else if (resource.resourceType === "ServiceRequest") {
      const request = resource as fhir4.ServiceRequest;
      if (request.id === orderId) order = request;
      else items.push(request);
    }
  }
  if (!order) return null;

  return {
    order,
    itemRequests: labOrderItemRequests(items, orderId),
    patient,
    task: labTasksByOrderId(tasks).get(orderId),
    specimens: labelSpecimensByOrderId(specimens).get(orderId) ?? [],
    reportId,
  };
}

/**
 * 患者番号(取込ファイルの PID-3)から患者を引く。同じ値の別体系の識別子が当たることが
 * あるので、院内の患者番号(DEFAULT_IDENTIFIER_SYSTEM)の一致を優先する。
 */
export async function fetchPatientByNumber(number: string): Promise<fhir4.Patient | null> {
  if (!number) return null;
  const params = new URLSearchParams();
  params.set("identifier", number);
  params.set("_count", "10");

  const { data: bundle } = await searchResource<fhir4.Patient>("Patient", params);
  const patients = (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is fhir4.Patient => resource?.resourceType === "Patient");
  const exact = patients.find((patient) =>
    patient.identifier?.some(
      (identifier) =>
        identifier.system === DEFAULT_IDENTIFIER_SYSTEM && identifier.value === number,
    ),
  );
  return exact ?? patients[0] ?? null;
}

/** ラベル番号から管(Specimen)を引く。到着確認のスキャン逆引き。 */
export async function fetchLabelSpecimenByNumber(number: string): Promise<fhir4.Specimen | null> {
  const params = new URLSearchParams();
  params.set("accession", `${LAB_LABEL_NUMBER_SYSTEM}|${number}`);

  const { data: bundle } = await searchResource<fhir4.Specimen>("Specimen", params);
  const specimen = (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .find((resource): resource is fhir4.Specimen => resource?.resourceType === "Specimen");
  return specimen ?? null;
}

/** オーダーの管(ラベル発行が作った Specimen)の一覧。orderId が空なら空配列。 */
export async function fetchLabelSpecimens(orderId: string): Promise<fhir4.Specimen[]> {
  if (!orderId) return [];
  const params = new URLSearchParams();
  params.set("request", `ServiceRequest/${orderId}`);
  params.set("_count", "100");

  const { data: bundle } = await searchResource<fhir4.Specimen>("Specimen", params);
  return (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is fhir4.Specimen => resource?.resourceType === "Specimen")
    .filter(isLabelSpecimen);
}

/**
 * 検体到着の記録・取消。管の Specimen(receivedTime)と、必要ならオーダーの進捗
 * (Task)を 1 つの transaction で書き込む(「最後の管の到着」と「実施済への遷移」が
 * 片方だけ成功する事態を避けるため)。
 */
export function useUpdateLabArrival() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      specimen,
      cancel,
      recorder,
      taskUpdate,
    }: {
      specimen: fhir4.Specimen;
      cancel?: boolean;
      recorder?: ArrivalRecorder;
      taskUpdate?: {
        order: fhir4.ServiceRequest;
        task: fhir4.Task | undefined;
        status: LabTaskStatus;
      };
    }) => {
      const resource = cancel
        ? buildSpecimenArrivalCancel(specimen)
        : buildSpecimenArrival(specimen, recorder);
      const entries: fhir4.BundleEntry[] = [
        { resource, request: { method: "PUT", url: `Specimen/${specimen.id}` } },
      ];
      if (taskUpdate) {
        const task = buildLabTaskUpdate(taskUpdate.task, taskUpdate.order, taskUpdate.status);
        entries.push({
          resource: task,
          request: task.id
            ? { method: "PUT", url: `Task/${task.id}` }
            : { method: "POST", url: "Task" },
        });
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry: entries });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "lab-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}
