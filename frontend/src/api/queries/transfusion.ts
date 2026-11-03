import { useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildTransfusionOrderDeleteBundle,
  isTransfusionServiceRequest,
  TRANSFUSION_ORDER_TYPE,
  transfusionOrderItemRequests,
} from "../../fhir/transfusionOrderHelpers";
import {
  buildTransfusionTaskUpdate,
  transfusionTasksByOrderId,
  transfusionTaskStatus,
  type TransfusionTaskStatus,
} from "../../fhir/transfusionTaskHelpers";
import {
  buildTransfusionPerformDeleteEntries,
  OBSERVATION_SYSTEM,
  REACTION_CODE,
} from "../../fhir/transfusionResultHelpers";
import { buildTransfusionDispenseDeleteEntries } from "../../fhir/transfusionDispenseHelpers";
import {
  autologousUnitsByOrderId,
  autologousUnitsOf,
  collectedVolumeTotal,
} from "../../fhir/autologousHelpers";
import { AUTOLOGOUS_SERVICE_TYPE } from "../../fhir/autologousPlanHelpers";
import { appointmentOrderId, isAutologousAppointment } from "../../fhir/appointmentHelpers";
import { SERVICE_TYPE_SYSTEM as SCHEDULE_SERVICE_TYPE_SYSTEM } from "../../fhir/scheduleHelpers";
import { fetchOrderAppointmentCancelEntries } from "./appointment";
import {
  DEFAULT_TRANSFUSION_SETTINGS,
  type TransfusionReactionHistory,
  type TransfusionSettings,
} from "../../fhir/transfusionAdvisoryHelpers";
import { WARD_TYPE_CODE } from "../../fhir/wardHelpers";
import { sortLocations } from "../../fhir/locationHelpers";
import { localDay } from "../../lib/dates";
import { useFacilitySettings } from "./organization";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { createResource, postBundle, searchResource } from "../fhirClient";
import { makeOrderDetailHook, resourcesOfType } from "./core";
import {
  cancelsPerform,
  comparePatientNumber,
  deleteOrderWithItems,
  fetchWorklistBundles,
  makePerformDetailHook,
  makeUpdateTaskStatusHook,
  performCancelEntries,
  worklistParams,
} from "./worklist";
import { invalidateOrderDependents } from "./orderDelete";

// ---- 輸血オーダー ----

// 輸血オーダーもヘッダと製剤明細が別リソースなので、病理・検体検査と同じ形で
// 1 リクエストにまとめて取る。自己血の採血予定(Appointment)もヘッダにぶら下がるので一緒に添える。
export const useTransfusionOrderDetail = makeOrderDetailHook("transfusion-order", {
  iterate: ["ServiceRequest:based-on"],
  direct: ["Appointment:based-on"],
});

/**
 * useDeleteTransfusionOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 * 残っている自己血の採血予定は同じ transaction で取り消す。
 */
export const deleteTransfusionOrderRequest = (srId: string) =>
  deleteOrderWithItems(srId, {
    itemsOf: transfusionOrderItemRequests,
    withAppointment: true,
    build: ({ srId, itemIds, appointmentEntries }) =>
      buildTransfusionOrderDeleteBundle(srId, itemIds, appointmentEntries),
  });

export function useDeleteTransfusionOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTransfusionOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Appointment"] });
      invalidateOrderDependents(queryClient);
    },
  });
}

// ---- オーダー画面の参照(副作用歴・使用場所・施設設定) ----

/**
 * 過去の輸血で副作用「あり」と記録した Observation。オーダー画面の警告に出す。
 * 実施記録の Observation は code が輸血副作用で値が なし / あり なので、値で絞る。
 */
export function useTransfusionReactionHistory(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("code", `${OBSERVATION_SYSTEM}|${REACTION_CODE.code}`);
  params.set("_count", "50");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "transfusion-reaction"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId),
    staleTime: 60 * 1000,
  });

  const history = useMemo<TransfusionReactionHistory[]>(
    () =>
      resourcesOfType<fhir4.Observation>(query.data?.data, "Observation")
        .filter((o) => o.valueCodeableConcept?.coding?.some((c) => c.code === "present"))
        .map((o) => ({
          date: localDay(o.effectiveDateTime),
          note: o.note?.[0]?.text ?? "",
        })),
    [query.data],
  );

  return { ...query, history };
}

/**
 * 使用場所の候補。製剤を届ける先なので、病棟(HU)と手術室・救急・検査処置室を並べる
 * (外来の診察室には届けない)。
 */
export function useTransfusionLocationOptions() {
  const params = new URLSearchParams();
  params.set("status", "active");
  params.set("type", [WARD_TYPE_CODE, "SU", "ER", "DX"].join(","));
  params.set("_count", "200");

  const query = useQuery({
    queryKey: ["Location", "search", "transfusion-options"],
    queryFn: () => searchResource<fhir4.Location>("Location", params),
    staleTime: 5 * 60 * 1000,
  });

  return {
    ...query,
    locations: sortLocations(resourcesOfType<fhir4.Location>(query.data?.data, "Location")),
  };
}

/**
 * 患者の自己血(採血済みで未出庫)。採血記録のハブ(Procedure)を _include で連れてくる。
 * 出庫入力の候補と、本人の血かの突き合わせに使う。
 */
export function useAutologousUnits(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("status", "preparation");
  params.set("_include", "MedicationDispense:part-of");
  params.set("_count", "100");

  const query = useQuery({
    queryKey: ["MedicationDispense", "search", patientId, "autologous"],
    queryFn: () => searchResource<fhir4.Resource>("MedicationDispense", params),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });

  const units = useMemo(
    () =>
      autologousUnitsOf(
        resourcesOfType<fhir4.Procedure>(query.data?.data, "Procedure"),
        resourcesOfType<fhir4.MedicationDispense>(query.data?.data, "MedicationDispense"),
      ),
    [query.data],
  );

  return { ...query, units };
}

/** 自己血の採血登録(ハブ + 採った血 1 本)。 */
export function useRegisterAutologousCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateTransfusion(queryClient),
  });
}

export function useTransfusionSettings(): TransfusionSettings {
  const settings = useFacilitySettings();
  return settings.data?.transfusion ?? DEFAULT_TRANSFUSION_SETTINGS;
}

/** オーダーの自己血の採血予定(取消したものも含め、予定日時の順)。詳細と採血の画面で使う。 */
export function useAutologousAppointments(orderId: string | undefined) {
  const params = new URLSearchParams();
  if (orderId) params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|${AUTOLOGOUS_SERVICE_TYPE.code}`);
  params.set("_sort", "date");
  params.set("_count", "100");

  const query = useQuery({
    queryKey: ["Appointment", "order", orderId, "autologous"],
    queryFn: () => searchResource<fhir4.Appointment>("Appointment", params),
    enabled: Boolean(orderId),
  });

  const appointments = useMemo(
    () => resourcesOfType<fhir4.Appointment>(query.data?.data, "Appointment").filter(isAutologousAppointment),
    [query.data],
  );

  return { ...query, appointments };
}

// ---- 輸血一覧(部門ワークリスト) ----
//
// 投与予定日で 1 日ぶんの輸血オーダーを読む。画面の作りは病理検査一覧と同じで、
// 輸血検査区分・製剤区分・入外区分・病棟・診療科・進捗での絞り込みは画面側で行う
// (理由は api/queries/rad.ts の「放射線検査一覧」の節)。
//
// 病理と違い DiagnosticReport は無い(輸血に結果レポートは無く、記録は実施記録側)。

/** 輸血一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface TransfusionWorklistRow {
  order: fhir4.ServiceRequest;
  /** 製剤明細。製剤名・単位数はここから組み立てる。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** 自己血の採血予定(取消したものを除く)。自己血を含まないオーダーは空。 */
  appointments: fhir4.Appointment[];
}

export interface TransfusionWorklistResult {
  rows: TransfusionWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchTransfusionWorklist(date: string): Promise<TransfusionWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];
  const appointments: fhir4.Appointment[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${TRANSFUSION_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 製剤明細と進捗、自己血の採血予定も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "Appointment:based-on");
      return params;
    },
    (resource) => {
      if (resource.resourceType === "Appointment") {
        appointments.push(resource as fhir4.Appointment);
        return false;
      }
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      // 検索にヒットしたヘッダと、添えられた明細を分ける。
      if (isTransfusionServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = transfusionTasksByOrderId(tasks);
  const appointmentsByOrderId = autologousAppointmentsByOrderId(appointments);

  const rows = orders.map((order) => ({
    order,
    itemRequests: transfusionOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
    appointments: appointmentsByOrderId.get(order.id ?? "") ?? [],
  }));

  // 輸血オーダーは投与予定時刻を持つが、日単位の一覧では患者番号順が扱いやすい
  // (病理・検体検査と同じ)。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** 投与予定日 1 日ぶんの輸血オーダー。日付が未選択の間は読みに行かない。 */
export function useTransfusionWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "transfusion-worklist", date],
    queryFn: () => fetchTransfusionWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/** 自己血の採血予定(取消したものを除く)をオーダー id ごとに、予定日時の順でまとめる。 */
function autologousAppointmentsByOrderId(appointments: fhir4.Appointment[]): Map<string, fhir4.Appointment[]> {
  const byOrderId = new Map<string, fhir4.Appointment[]>();
  for (const appointment of appointments) {
    if (!isAutologousAppointment(appointment)) continue;
    if (appointment.status === "cancelled" || appointment.status === "entered-in-error") continue;
    const orderId = appointmentOrderId(appointment);
    if (!orderId) continue;
    const list = byOrderId.get(orderId) ?? [];
    list.push(appointment);
    byOrderId.set(orderId, list);
  }
  for (const list of byOrderId.values()) list.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  return byOrderId;
}

// ---- 自己血の採血予定日の一覧 ----
//
// 輸血一覧の日付の軸を「採血予定日」に切り替えたときの行。採血予定(Appointment)を日付で引き、
// その予定がぶら下がるオーダーを _id で引き直す(予定はオーダーより少ないので 2 往復で済む)。
// 採血済みの合計はオーダーの採血記録(Procedure + MedicationDispense)から足す。

/** 採血予定の 1 行 = 予定 1 件。 */
export interface AutologousWorklistRow {
  appointment: fhir4.Appointment;
  row: TransfusionWorklistRow;
  /** これまでに採った量(mL)の合計。 */
  collectedVolume: number;
}

async function fetchAutologousWorklist(
  date: string,
): Promise<{ rows: AutologousWorklistRow[]; truncated: boolean }> {
  const params = new URLSearchParams();
  params.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|${AUTOLOGOUS_SERVICE_TYPE.code}`);
  params.set("date", date);
  params.set("_sort", "date");
  params.set("_count", "200");
  const { data: bundle } = await searchResource<fhir4.Appointment>("Appointment", params);
  const appointments = resourcesOfType<fhir4.Appointment>(bundle, "Appointment").filter(
    (a) => a.status !== "entered-in-error",
  );
  const truncated = (bundle.link ?? []).some((link) => link.relation === "next");
  const orderIds = Array.from(new Set(appointments.map(appointmentOrderId).filter(Boolean)));
  if (orderIds.length === 0) return { rows: [], truncated };

  const orderParams = new URLSearchParams();
  orderParams.set("_id", orderIds.join(","));
  orderParams.set("_include", "ServiceRequest:subject");
  // 製剤明細・進捗・採血記録(ハブと採った血)を同じ応答に添えてもらう。
  orderParams.set("_revinclude:iterate", "ServiceRequest:based-on");
  orderParams.append("_revinclude", "Task:focus");
  orderParams.append("_revinclude", "Procedure:based-on");
  orderParams.append("_revinclude:iterate", "MedicationDispense:part-of");
  orderParams.set("_count", "500");
  const { data: orderBundle } = await searchResource<fhir4.Resource>("ServiceRequest", orderParams);

  const requests = resourcesOfType<fhir4.ServiceRequest>(orderBundle, "ServiceRequest");
  const patientsById = new Map(
    resourcesOfType<fhir4.Patient>(orderBundle, "Patient").map((patient) => [patient.id ?? "", patient]),
  );
  const taskByOrderId = transfusionTasksByOrderId(resourcesOfType<fhir4.Task>(orderBundle, "Task"));
  const unitsByOrderId = autologousUnitsByOrderId(
    resourcesOfType<fhir4.Procedure>(orderBundle, "Procedure"),
    resourcesOfType<fhir4.MedicationDispense>(orderBundle, "MedicationDispense"),
  );
  const appointmentsByOrderId = autologousAppointmentsByOrderId(appointments);

  const rows = appointments.flatMap((appointment) => {
    const orderId = appointmentOrderId(appointment);
    const order = requests.find((request) => request.id === orderId);
    if (!order) return [];
    return [
      {
        appointment,
        row: {
          order,
          itemRequests: transfusionOrderItemRequests(requests, orderId),
          patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
          task: taskByOrderId.get(orderId),
          appointments: appointmentsByOrderId.get(orderId) ?? [],
        },
        collectedVolume: collectedVolumeTotal(unitsByOrderId.get(orderId) ?? []),
      },
    ];
  });
  return { rows, truncated };
}

/** 採血予定日 1 日ぶんの自己血の採血予定。日付が未選択の間は読みに行かない。 */
export function useAutologousWorklist(date: string, enabled = true) {
  return useQuery({
    queryKey: ["Appointment", "autologous-worklist", date],
    queryFn: () => fetchAutologousWorklist(date),
    enabled: Boolean(date) && enabled,
    placeholderData: keepPreviousData,
  });
}

// ---- 輸血の実施記録 ----

/** 実施記録と出庫記録(ハブとバッグ)。 */
export const useTransfusionPerformDetail = makePerformDetailHook("transfusion-perform", {
  observations: true,
  dispenses: true,
});

/** 出庫済から戻す(出庫取消)か。出庫記録を消す。 */
function cancelsDispense(task: fhir4.Task | undefined, status: TransfusionTaskStatus): boolean {
  return transfusionTaskStatus(task) === "in-progress" && status === "accepted";
}

/**
 * 受付・出庫・中止などの進捗を書き込む。実施済から戻す(実施取消)ときは実施記録を、
 * 出庫済から戻す(出庫取消)ときは出庫記録を、同じ transaction で消す
 * (理由は transfusionResultHelpers の buildTransfusionPerformDeleteEntries を参照)。
 */
export const useUpdateTransfusionTaskStatus = makeUpdateTaskStatusHook<TransfusionTaskStatus>(
  buildTransfusionTaskUpdate,
  "transfusion-worklist",
  {
    cancelPerform: {
      cancels: (task, status) =>
        cancelsPerform(transfusionTaskStatus)(task, status) ||
        cancelsDispense(task, status) ||
        status === "cancelled",
      entries: async (order, task, status) => [
        ...(cancelsPerform(transfusionTaskStatus)(task, status) || cancelsDispense(task, status)
          ? await performCancelEntries(
              order.id ?? "",
              { observations: true, dispenses: true },
              (procedures, administrations, observations, dispenses) => [
                ...(cancelsPerform(transfusionTaskStatus)(task, status)
                  ? buildTransfusionPerformDeleteEntries(procedures, administrations, observations)
                  : []),
                ...(cancelsDispense(task, status)
                  ? buildTransfusionDispenseDeleteEntries(procedures, dispenses)
                  : []),
              ],
            )
          : []),
        // 中止では、残っている自己血の採血予定も取り消す。
        ...(status === "cancelled" ? await fetchOrderAppointmentCancelEntries(order.id ?? "") : []),
      ],
    },
    invalidate: invalidateTransfusion,
  },
);

/**
 * 輸血の出庫登録。出庫記録一式(ハブ・バッグ)と Task の出庫済を 1 つの transaction で書き込む。
 * Bundle の組み立ては transfusionDispenseHelpers を参照。
 */
export function useRegisterTransfusionDispense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateTransfusion(queryClient),
  });
}

/**
 * 輸血の実施登録。実施記録一式と Task の実施済を 1 つの transaction で書き込む。
 * Bundle の組み立ては transfusionResultHelpers を参照。
 */
export function useRegisterTransfusionPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateTransfusion(queryClient),
  });
}

/**
 * 実施済みの輸血への副作用の追記(遅発性副作用)。実施記録のハブにぶら下がる Observation を 1 件足す。
 */
export function useAddTransfusionReaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (observation: fhir4.Observation) => createResource(observation),
    onSuccess: () => {
      invalidateTransfusion(queryClient);
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

/** 輸血の進捗・実施記録が動いたときに読み直させるもの。 */
function invalidateTransfusion(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "transfusion-worklist"] });
  // カルテのオーダーカードも進捗と実施情報を出しているので読み直させる。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  // 取消では実施記録・出庫記録も消しているので、FHIRリソース表示の実施記録も引き直させる。
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
  queryClient.invalidateQueries({ queryKey: ["MedicationDispense"] });
  // 採血登録と中止で自己血の採血予定(Appointment)が動く。
  queryClient.invalidateQueries({ queryKey: ["Appointment"] });
}
