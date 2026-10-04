import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  appointmentOrderId,
  appointmentSlotIds,
  buildBookBundle,
  buildCancelBundle,
  buildCancelEntries,
  buildRescheduleBundle,
} from "../../fhir/appointmentHelpers";
import { postBundle, readResource, searchResource } from "../fhirClient";
import { resourcesOfType } from "./core";

// ---- 予約(Appointment) ----

/**
 * その患者の予約。1 患者の予約は当面 100 件を超えない前提でまとめて取り、
 * 並べ替え(新しい順)は画面側で行う(上流の _sort に依存しないため)。
 */
export function useAppointmentSearch(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", "100");
  // 新しい順。上流は同値を id でタイブレークするのでページ送りをまたいでも安定する。
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Appointment", "search", patientId],
    queryFn: () => searchResource<fhir4.Appointment>("Appointment", params),
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    appointments:
      resourcesOfType<fhir4.Appointment>(query.data?.data, "Appointment"),
  };
}

export function useAppointment(id: string | undefined) {
  return useQuery({
    queryKey: ["Appointment", id],
    queryFn: () => readResource<fhir4.Appointment>("Appointment", id as string),
    enabled: Boolean(id),
  });
}

/** 取り消せる予約(`isActiveAppointment`)だけを返す status 条件を付ける。 */
export function setActiveAppointmentStatus(params: URLSearchParams) {
  params.set("status", ACTIVE_APPOINTMENT_STATUSES.join(","));
}

/**
 * オーダーに紐づく有効な検査予約(放射線・生理検査・内視鏡・処置は 1 オーダーに 1 件)。
 * 予約日時の変更はオーダーの編集画面から行うので、編集を開くときに予約の現物を用意しておく。
 */
export function useOrderAppointment(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("based-on", `ServiceRequest/${srId}`);
  setActiveAppointmentStatus(params);

  const query = useQuery({
    queryKey: ["Appointment", "order", srId],
    queryFn: () => searchResource<fhir4.Appointment>("Appointment", params),
    enabled: Boolean(srId),
  });

  return {
    ...query,
    appointment: query.data
      ? resourcesOfType<fhir4.Appointment>(query.data.data, "Appointment")[0]
      : undefined,
  };
}

// 予約の登録・取消・日時変更。いずれも Appointment と Slot を 1 つの transaction で
// 書く(Bundle の組み立ては appointmentHelpers を参照)。
//
// 取消・変更で空きに戻す枠は、一覧が持っているのは参照だけなので mutation の中で
// 引き直す。Slot の現物が無いと status だけを差し替えた PUT を組めない。
export function invalidateAppointments(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["Appointment"] });
  queryClient.invalidateQueries({ queryKey: ["Slot"] });
}

/** 予約が押さえている枠の現物(Slot.id → Slot)。複数の予約の分を 1 回の検索で引く。 */
async function fetchSlotsById(appointments: fhir4.Appointment[]): Promise<Map<string, fhir4.Slot>> {
  const ids = [...new Set(appointments.flatMap(appointmentSlotIds))];
  if (ids.length === 0) return new Map();
  const params = new URLSearchParams();
  params.set("_id", ids.join(","));
  params.set("_count", String(ids.length));
  const { data: bundle } = await searchResource<fhir4.Slot>("Slot", params);
  return new Map(
    resourcesOfType<fhir4.Slot>(bundle, "Slot").flatMap((slot) => (slot.id ? [[slot.id, slot]] : [])),
  );
}

function slotsOf(appointment: fhir4.Appointment, slotsById: Map<string, fhir4.Slot>): fhir4.Slot[] {
  return appointmentSlotIds(appointment)
    .map((id) => slotsById.get(id))
    .filter((slot): slot is fhir4.Slot => Boolean(slot));
}

export async function fetchAppointmentSlots(appointment: fhir4.Appointment): Promise<fhir4.Slot[]> {
  return slotsOf(appointment, await fetchSlotsById([appointment]));
}

/** 予約それぞれの取消エントリ(予約の取消と、押さえていた枠を空きに戻す PUT)。 */
export async function buildCancelEntriesOf(appointments: fhir4.Appointment[]): Promise<fhir4.BundleEntry[]> {
  const slotsById = await fetchSlotsById(appointments);
  return appointments.flatMap((appointment) =>
    buildCancelEntries(appointment, slotsOf(appointment, slotsById)),
  );
}

/** オーダーヘッダに紐づく有効な予約の取消エントリ。予約が無ければ空。 */
export async function fetchOrderAppointmentCancelEntries(srId: string): Promise<fhir4.BundleEntry[]> {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${srId}`);
  setActiveAppointmentStatus(params);
  const { data: bundle } = await searchResource<fhir4.Appointment>("Appointment", params);
  return buildCancelEntriesOf(resourcesOfType<fhir4.Appointment>(bundle, "Appointment"));
}

export function useBookAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ appointment, slots }: { appointment: fhir4.Appointment; slots: fhir4.Slot[] }) =>
      postBundle(buildBookBundle(appointment, slots)),
    // 先に枠を取られて 412 になったときも、枠の空き状況を読み直す。
    onSettled: () => invalidateAppointments(queryClient),
  });
}

export function useCancelAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (appointment: fhir4.Appointment) =>
      postBundle(buildCancelBundle(appointment, await fetchAppointmentSlots(appointment))),
    onSuccess: () => invalidateAppointments(queryClient),
  });
}

/**
 * 診察予約の日時変更。検査予約(オーダーにぶら下がる予約)の日時は、オーダーヘッダの
 * 撮影日時と同時に動かす必要があるので、この mutation ではなく放射線オーダーの更新
 * (useUpdateRadOrder)に同梱して変える。
 */
export function useRescheduleAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appointment,
      slots,
    }: {
      appointment: fhir4.Appointment;
      slots: fhir4.Slot[];
    }) =>
      postBundle(
        buildRescheduleBundle(appointment, await fetchAppointmentSlots(appointment), slots),
      ),
    onSettled: () => invalidateAppointments(queryClient),
  });
}

/** オーダー id → 有効な予約(1 件)。`basedOn` で引く。 */
export async function fetchOrderAppointments(ids: string[]): Promise<Map<string, fhir4.Appointment>> {
  const result = new Map<string, fhir4.Appointment>();
  if (ids.length === 0) return result;
  const params = new URLSearchParams();
  params.set("based-on", ids.map((id) => `ServiceRequest/${id}`).join(","));
  setActiveAppointmentStatus(params);
  params.set("_count", String(ids.length * 2));
  const { data: bundle } = await searchResource<fhir4.Appointment>("Appointment", params);
  for (const appointment of resourcesOfType<fhir4.Appointment>(bundle, "Appointment")) {
    const orderId = appointmentOrderId(appointment);
    if (orderId) result.set(orderId, appointment);
  }
  return result;
}

/**
 * オーダーに紐づく予約を取り消す entry(押さえていた枠は空きに戻す)。オーダーを消す・止める
 * ときに予約だけが残ると、枠が埋まったままになり患者も呼ばれてしまう。
 */
export async function orderAppointmentCancelEntries(orderIds: string[]): Promise<fhir4.BundleEntry[]> {
  const appointments = await fetchOrderAppointments(Array.from(new Set(orderIds.filter(Boolean))));
  return buildCancelEntriesOf(Array.from(appointments.values()));
}
