import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orderDay, referenceId } from "../../fhir/shared";
import { buildInjectionTaskUpdate, injectionTasksByOrderId, type InjectionTaskStatus } from "../../fhir/injectionTaskHelpers";
import { serviceRequestsOf } from "../../fhir/labOrderHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { buildRxTaskUpdate, rxTasksByOrderId, type RxTaskStatus } from "../../fhir/rxTaskHelpers";
import {
  buildRegimenMoveBundle,
  discontinuationReasonLabel,
  isRegimenServiceRequest,
  parseRegimenApplication,
  REGIMEN_INSTANCE_SYSTEM,
  REGIMEN_ORDER_TYPE,
  type RegimenApplication,
  type RegimenDayOrder,
  regimenDayOrderKind,
  type RegimenDiscontinuation,
  regimenOrderOf,
  revokeRegimenEntry,
  sortByRp,
} from "../../fhir/regimenOrderHelpers";
import { SERVICE_TYPE_SYSTEM as SCHEDULE_SERVICE_TYPE_SYSTEM } from "../../fhir/scheduleHelpers";
import {
  appointmentActorId,
  appointmentOrderId,
  buildChemoAppointmentBundle,
  type SlotSelection,
} from "../../fhir/appointmentHelpers";
import { postBundle, searchResource } from "../fhirClient";
import {
  fetchOrderAppointments,
  invalidateAppointments,
  orderAppointmentCancelEntries,
  setActiveAppointmentStatus,
} from "./appointment";
import { invalidateProvenance, useActivityProvenance, useWithOrderProvenance } from "./provenance";
import { taskBundleEntry } from "./worklist";

// ---- 化学療法レジメンオーダー(docs/chemo-regimen-design.md §7) ----

/**
 * 患者に適用されたレジメン(ヘッダ)。中止・完了も含めて全件返す(タブで切り替える)。
 * 1 患者のレジメン適用は多くても十数件なので 1 ページで足りる。
 */
export function useRegimenApplications(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${REGIMEN_ORDER_TYPE.code}`);
  params.set("_sort", "-occurrence");
  params.set("_count", "100");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "regimen-applications", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const headers = serviceRequestsOf(bundle).filter(isRegimenServiceRequest);
      return {
        headers,
        applications: headers
          .map(parseRegimenApplication)
          .filter((a): a is RegimenApplication => a !== null),
      };
    },
    enabled: Boolean(patientId),
  });
}

/**
 * 外来化学療法室の予約(§7.6 D-3)。投与日の注射オーダーを `basedOn` にして日ごとに取る。
 * 予約タブと投与日パネルの両方から読み直させる。
 */
export function useBookChemoAppointment() {
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
    }) => postBundle(buildChemoAppointmentBundle(patient, selection, orderId)),
    onSuccess: () => invalidateAppointments(queryClient),
  });
}

/** 投与日の注射オーダーに紐づく予約(1 件)。投与日パネルで「予約済み」を出すのに使う。 */
export function useOrderAppointments(orderIds: string[]) {
  const ids = Array.from(new Set(orderIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["Appointment", "search", "by-order", ids],
    queryFn: () => fetchOrderAppointments(ids),
    enabled: ids.length > 0,
  });
}

/**
 * 日オーダーに紐づく化学療法室の予約を取り消す entry。投与日の移動・中止、レジメンの
 * 中止・完了・クール取消に同梱する(§8.13 N-5)。予約が無ければ空。
 */
export function chemoAppointmentCancelEntries(orders: RegimenDayOrder[]): Promise<fhir4.BundleEntry[]> {
  return orderAppointmentCancelEntries(orders.map((o) => o.serviceRequest.id ?? ""));
}

/**
 * レジメンの適用ヘッダを id で引く(薬剤部の監査。§7.6 E-1)。日オーダーの `regimen-order`
 * 拡張から得た id をまとめて 1 回で読む。患者単位の `useRegimenApplications` と違い、
 * 別々の患者のオーダーが並ぶワークリストから使える。
 */
export function useRegimenHeaders(regimenSrIds: string[]) {
  const ids = Array.from(new Set(regimenSrIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["ServiceRequest", "detail", "regimen-headers", ids],
    queryFn: async (): Promise<Map<string, RegimenApplication>> => {
      const params = new URLSearchParams();
      params.set("_id", ids.join(","));
      params.set("_count", String(ids.length));
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const result = new Map<string, RegimenApplication>();
      for (const sr of serviceRequestsOf(bundle)) {
        const application = parseRegimenApplication(sr);
        if (application) result.set(application.id, application);
      }
      return result;
    },
    enabled: ids.length > 0,
    staleTime: 60 * 1000,
  });
}

/**
 * レジメンから出た日オーダー(注射・処方)を、適用(instanceId = 日オーダーの requisition)
 * ごとにまとめて引く。requisition はカンマで OR にできるので患者の全適用を 1 検索で読める。
 * 進捗の Task と薬剤も同じレスポンスで受ける。1 患者の日オーダーは多くても数百件なので
 * 1 ページで足りる。
 */
export function useRegimenDayOrders(patientId: string | undefined, instanceIds: string[]) {
  const ids = [...new Set(instanceIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["ServiceRequest", "search", "regimen-orders", patientId, ids.join(",")],
    queryFn: async (): Promise<RegimenDayOrder[]> => {
      const requests: fhir4.ServiceRequest[] = [];
      const medicationRequests: fhir4.MedicationRequest[] = [];
      const tasks: fhir4.Task[] = [];
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("requisition", ids.map((id) => `${REGIMEN_INSTANCE_SYSTEM}|${id}`).join(","));
      params.set("based-on:missing", "true");
      params.set("_sort", "occurrence");
      params.set("_count", "500");
      params.append("_revinclude", "MedicationRequest:based-on");
      params.append("_revinclude", "Task:focus");
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      for (const entry of bundle.entry ?? []) {
        const resource = entry.resource;
        if (!resource) continue;
        if (resource.resourceType === "ServiceRequest") {
          const sr = resource as fhir4.ServiceRequest;
          if (regimenOrderOf(sr)) requests.push(sr);
        } else if (resource.resourceType === "MedicationRequest") {
          medicationRequests.push(resource as fhir4.MedicationRequest);
        } else if (resource.resourceType === "Task") {
          tasks.push(resource as fhir4.Task);
        }
      }

      const mrsByOrderId = new Map<string, fhir4.MedicationRequest[]>();
      for (const mr of medicationRequests) {
        for (const reference of mr.basedOn ?? []) {
          const orderId = referenceId(reference.reference);
          if (!orderId) continue;
          mrsByOrderId.set(orderId, [...(mrsByOrderId.get(orderId) ?? []), mr]);
        }
      }
      const injectionTasks = injectionTasksByOrderId(tasks);
      const rxTasks = rxTasksByOrderId(tasks);

      return requests
        .map((sr): RegimenDayOrder | null => {
          const ref = regimenOrderOf(sr);
          if (!ref || !sr.id) return null;
          const kind = regimenDayOrderKind(sr);
          const task = kind === "injection" ? injectionTasks.get(sr.id) : rxTasks.get(sr.id);
          const status = (task?.status ?? "requested") as RegimenDayOrder["status"];
          return {
            kind,
            serviceRequest: sr,
            medicationRequests: sortByRp(mrsByOrderId.get(sr.id) ?? []),
            task,
            ref,
            date: orderDay(sr),
            status,
          };
        })
        .filter((o): o is RegimenDayOrder => o !== null)
        .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
    },
    enabled: Boolean(patientId) && ids.length > 0,
  });
}

export function regimenDayTaskEntry(
  order: RegimenDayOrder,
  status: InjectionTaskStatus,
  /** 中止の理由(Task.statusReason)。中止以外では消す(中止取消で古い理由が残らないように)。 */
  reason?: string,
): fhir4.BundleEntry {
  const task =
    order.kind === "injection"
      ? buildInjectionTaskUpdate(order.task, order.serviceRequest, status)
      : buildRxTaskUpdate(order.task, order.serviceRequest, status as RxTaskStatus);
  const { statusReason: _dropped, ...rest } = task;
  const next: fhir4.Task =
    status === "cancelled" && reason?.trim() ? { ...rest, statusReason: { text: reason.trim() } } : rest;
  return taskBundleEntry(next);
}

export function invalidateRegimen(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "injection-worklist"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rx-worklist"] });
  // 移動・中止で化学療法室の予約も取り消すので、予約タブと投与日パネルにも読み直させる。
  invalidateAppointments(queryClient);
}

/** まだ止めていない(実施済でも中止でもない)日オーダー。 */
export function pendingRegimenOrders(targets: RegimenDayOrder[]): RegimenDayOrder[] {
  return targets.filter((order) => order.status !== "completed" && order.status !== "cancelled");
}

/**
 * 投与日の移動(§7.4)。内容は変えず日付だけ差し替えて同じ id へ PUT する。その日に取ってあった
 * 化学療法室の予約は取り消す(日時が変わるので自動では取り直さない。§8.13 N-5)。
 * 来歴は注射・処方の更新と同じく付ける。
 */
export function useMoveRegimenDays() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: async ({
      targets,
      deltaDays,
      patientId,
    }: {
      targets: RegimenDayOrder[];
      deltaDays: number;
      patientId: string;
    }) => {
      const bundle = withProvenance(buildRegimenMoveBundle(targets, deltaDays, patientId));
      const cancels = await chemoAppointmentCancelEntries(targets);
      return postBundle({ ...bundle, entry: [...(bundle.entry ?? []), ...cancels] });
    },
    onSuccess: () => {
      invalidateRegimen(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * レジメンの日オーダーの中止・中止取消。注射は注射の Task、処方は処方の Task に
 * 同じ状態を書く。複数日をまとめて 1 つの transaction で書く(半端に止まらない)。
 * 中止では化学療法室の予約も取り消す(中止取消で予約は戻さない。取り直す)。
 */
export function useUpdateRegimenDayStatus() {
  const queryClient = useQueryClient();
  const activityProvenance = useActivityProvenance();
  return useMutation({
    mutationFn: async ({
      targets,
      status,
      reason,
    }: {
      targets: RegimenDayOrder[];
      status: "cancelled" | "requested";
      reason?: string;
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          ...targets.map((order) => regimenDayTaskEntry(order, status, reason)),
          ...(status === "cancelled" ? await chemoAppointmentCancelEntries(targets) : []),
          // 誰がどの投与日を止めたか(代行なら指示医師の承認待ちに並ぶ)。
          ...activityProvenance(
            targets.map((order) => order.serviceRequest),
            status === "cancelled" ? "CANCEL" : "REACTIVATE",
          ),
        ],
      }),
    onSuccess: () => {
      invalidateRegimen(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * レジメンの中止。ヘッダを revoked にし、まだ実施していない日オーダーを中止にする
 * (実施済は事実なので触らない)。止める日の化学療法室の予約も取り消す。
 */
export function useRevokeRegimen() {
  const queryClient = useQueryClient();
  const activityProvenance = useActivityProvenance();
  return useMutation({
    mutationFn: async ({
      header,
      targets,
      discontinuation,
    }: {
      header: fhir4.ServiceRequest;
      targets: RegimenDayOrder[];
      discontinuation: Pick<RegimenDiscontinuation, "reason" | "note">;
    }) => {
      const pending = pendingRegimenOrders(targets);
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          revokeRegimenEntry(header, discontinuation),
          ...pending.map((order) =>
            regimenDayTaskEntry(order, "cancelled", discontinuationReasonLabel(discontinuation.reason)),
          ),
          ...(await chemoAppointmentCancelEntries(pending)),
          // 中止はレジメン全体への判断なので、対象はヘッダだけにする(日オーダーはヘッダから辿れる)。
          ...activityProvenance([header], "CANCEL"),
        ],
      });
    },
    onSuccess: () => {
      invalidateRegimen(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 外来化学療法室の当日一覧(§7.6 E-7)。その日の化学療法予約を、患者・注射オーダー・進捗と
 * 一緒に並べる。化学療法室は「予約の時間割」で回るので、注射一覧(オーダー軸)ではなく
 * **予約軸**の面にする。
 *
 * 予約 → 患者は `_include`、予約 → 注射オーダーは `basedOn` の id で引き直す
 * (進捗の Task も同じ応答で受ける)。
 */
export interface ChemoRoomRow {
  appointment: fhir4.Appointment;
  patient?: fhir4.Patient;
  order?: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
  task?: fhir4.Task;
}

export function useChemoRoomList(date: string) {
  return useQuery({
    queryKey: ["Appointment", "search", "chemo-room", date],
    queryFn: async (): Promise<ChemoRoomRow[]> => {
      const params = new URLSearchParams();
      params.set("date", date);
      params.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|chemo`);
      setActiveAppointmentStatus(params);
      params.set("_count", "200");
      params.set("_sort", "date");
      params.append("_include", "Appointment:patient");
      // 予約が指す日オーダーと、そのオーダーの進捗 Task・薬剤も同じ応答で揃える。
      params.append("_include", "Appointment:based-on");
      params.append("_revinclude:iterate", "Task:focus,MedicationRequest:based-on");
      const { data: bundle } = await searchResource<fhir4.Resource>("Appointment", params);

      const appointments: fhir4.Appointment[] = [];
      const patientsById = new Map<string, fhir4.Patient>();
      const ordersById = new Map<string, fhir4.ServiceRequest>();
      const tasks: fhir4.Task[] = [];
      const mrsByOrderId = new Map<string, fhir4.MedicationRequest[]>();
      for (const entry of bundle.entry ?? []) {
        const resource = entry.resource;
        if (resource?.resourceType === "Appointment") {
          appointments.push(resource as fhir4.Appointment);
        } else if (resource?.resourceType === "Patient" && resource.id) {
          patientsById.set(resource.id, resource as fhir4.Patient);
        } else if (resource?.resourceType === "ServiceRequest" && resource.id) {
          ordersById.set(resource.id, resource as fhir4.ServiceRequest);
        } else if (resource?.resourceType === "Task") {
          tasks.push(resource as fhir4.Task);
        } else if (resource?.resourceType === "MedicationRequest") {
          const mr = resource as fhir4.MedicationRequest;
          for (const reference of mr.basedOn ?? []) {
            const id = referenceId(reference.reference);
            if (id) mrsByOrderId.set(id, [...(mrsByOrderId.get(id) ?? []), mr]);
          }
        }
      }
      const tasksByOrderId = injectionTasksByOrderId(tasks);

      return appointments
        .map((appointment) => {
          const orderId = appointmentOrderId(appointment);
          const patientId = appointmentActorId(appointment, "Patient");
          return {
            appointment,
            patient: patientId ? patientsById.get(patientId) : undefined,
            order: orderId ? ordersById.get(orderId) : undefined,
            medicationRequests: orderId ? sortByRp(mrsByOrderId.get(orderId) ?? []) : [],
            task: orderId ? tasksByOrderId.get(orderId) : undefined,
          };
        })
        .sort((a, b) => (a.appointment.start ?? "").localeCompare(b.appointment.start ?? ""));
    },
    enabled: Boolean(date),
  });
}
