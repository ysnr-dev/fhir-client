import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ACTIVE_APPOINTMENT_STATUSES, appointmentOrderId } from "../../fhir/appointmentHelpers";
import {
  buildDialysisAppointmentBatchBundle,
  buildDialysisRescheduleBundle,
  type DialysisBooking,
} from "../../fhir/dialysisAppointmentHelpers";
import {
  DEFAULT_DIALYSIS_SHIFTS,
  sortedDialysisShifts,
  type DialysisShift,
} from "../../fhir/dialysisShiftHelpers";
import {
  buildDialysisOrderCloseEntry,
  DIALYSIS_ORDER_TYPE,
  isDialysisServiceRequest,
} from "../../fhir/dialysisOrderHelpers";
import {
  buildDialysisTaskUpdate,
  dialysisTasksByOrderId,
  type DialysisTaskStatus,
} from "../../fhir/dialysisTaskHelpers";
import {
  DIALYSIS_LOCATION_TYPE,
  generateDialysisSlots,
  groupDialysisLocations,
  scheduleBedId,
  type DialysisUnitGroup,
} from "../../fhir/dialysisUnitHelpers";
import {
  buildDialysisChartData,
  buildDialysisChartDeleteEntries,
  DIALYSIS_CHART_TYPE,
  dialysisChartSessionIds,
  isDialysisChartHub,
  type DialysisChartData,
} from "../../fhir/dialysisChartHelpers";
import { DIALYSIS_MEMO_TAG_TOKEN, dialysisMemoOf } from "../../fhir/dialysisMemoHelpers";
import {
  buildDialysisPerformDeleteBundle,
  dialysisSessionOrderId,
  DRY_WEIGHT_CODE,
  dryWeightOf,
  groupDialysisSessions,
  type DialysisSession,
} from "../../fhir/dialysisResultHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { buildSlotCreateBundle, SERVICE_TYPE_SYSTEM as SCHEDULE_SERVICE_TYPE_SYSTEM } from "../../fhir/scheduleHelpers";
import { orderCancelEntries } from "../../fhir/taskHelpers";
import { addDays, today } from "../../lib/dates";
import { postBundle, readResource, searchResource } from "../fhirClient";
import {
  fetchAppointmentSlots,
  fetchOrderAppointmentCancelEntries,
  invalidateAppointments,
  setActiveAppointmentStatus,
} from "./appointment";
import {
  fetchAllByPartOf,
  makeOrderDetailHook,
  ORDER_PERFORM_REVINCLUDES,
  resourcesOfType,
  searchAllPages,
  setOrderPeriod,
  type Truncatable,
  WORKLIST_PAGE,
} from "./core";
import { invalidateOrderDependents, postOrderDeleteBundle } from "./orderDelete";
import { useFacilitySettings } from "./organization";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";
import { comparePatientNumber, fetchWorklistBundles, taskBundleEntry } from "./worklist";

// ---- 透析オーダー ----
//
// リハビリと同じ期間継続型で、明細を持たずヘッダ 1 本で済む(docs/dialysis-order-design.md)。

// 実施記録の子(測定値・薬剤)まで同じ応答に揃える(詳細に各回の体重・除水を並べるため)。
export const useDialysisOrderDetail = makeOrderDetailHook<fhir4.Resource>("dialysis-order", {
  ...ORDER_PERFORM_REVINCLUDES,
  iterate: ["Observation:part-of", "MedicationAdministration:part-of"],
});

/** 施設設定のシフト(開始の早い順)。 */
export function useDialysisShifts() {
  const settings = useFacilitySettings();
  return sortedDialysisShifts((settings.data?.dialysis_shifts ?? DEFAULT_DIALYSIS_SHIFTS).shifts);
}

/** その患者の、今日に効いている透析オーダー。患者帯の印に使う。 */
export function useActiveDialysisOrders(patientId: string | undefined) {
  const date = today();
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${DIALYSIS_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, date, date);
  params.set("_sort", "-authoredon");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "dialysis-active", patientId, date],
    queryFn: async () => {
      const { matches } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
        page: 100,
        maxPages: 1,
      });
      return matches.filter(isDialysisServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

/**
 * その患者の有効な透析オーダー(期間を問わない)。退院で打ち切る対象(入院のオーダー)を選ぶのに使う。
 * 打ち切りの対象を取りこぼさないよう、ページを辿って全件読む。
 */
export function usePatientDialysisOrders(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${DIALYSIS_ORDER_TYPE.code}`);
  params.set("status", "active");
  params.set("_sort", "-authoredon");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "dialysis-patient", patientId],
    queryFn: async () => {
      const { matches } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
        page: 500,
        maxPages: 4,
        complete: true,
      });
      return matches.filter(isDialysisServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

/** 直近のドライウェイト。患者単位の Observation(実施の終了で見直したときに足される)。 */
export function useLatestDryWeight(patientId: string | undefined) {
  return useQuery({
    queryKey: ["Observation", "dialysis-dry-weight", patientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("subject", `Patient/${patientId}`);
      params.set("code", DRY_WEIGHT_CODE);
      params.set("_sort", "-date");
      params.set("_count", "1");
      const { data } = await searchResource<fhir4.Observation>("Observation", params);
      return dryWeightOf(data.entry?.find((e) => e.resource?.resourceType === "Observation")?.resource);
    },
    enabled: Boolean(patientId),
  });
}

/**
 * 透析の患者メモ(患者 1 人に 1 件のテンプレート回答)。用途の印で引くので strict にする
 * (上流が `_tag` を知らないと全件が返り、別の回答をメモとして出してしまう)。
 */
export function useDialysisMemo(patientId: string | undefined) {
  return useQuery({
    queryKey: ["QuestionnaireResponse", "search", "dialysis-memo", patientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("_tag", DIALYSIS_MEMO_TAG_TOKEN);
      params.set("_sort", "-authored");
      params.set("_count", "1");
      params.set("_include", "QuestionnaireResponse:questionnaire");
      const { data } = await searchResource<fhir4.Resource>("QuestionnaireResponse", params, { strict: true });
      return dialysisMemoOf(data);
    },
    enabled: Boolean(patientId),
  });
}

export function useUpdateDialysisOrder() {
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
 * オーダーを消す。部門が取った予約は道連れで取り消す(予約だけが残って枠を塞ぐのを防ぐ)。
 * 実施記録が付いたオーダーは postOrderDeleteBundle が止める。
 *
 * useDeleteDialysisOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteDialysisOrderRequest = async (srId: string) => {
  const appointmentEntries = await fetchOrderAppointmentCancelEntries(srId);
  return postOrderDeleteBundle({
    resourceType: "Bundle",
    type: "transaction",
    entry: [...appointmentEntries, { request: { method: "DELETE", url: `ServiceRequest/${srId}` } }],
  });
};

export function useDeleteDialysisOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteDialysisOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      invalidateAppointments(queryClient);
      invalidateOrderDependents(queryClient);
    },
  });
}

// ---- 透析室・ベッド・枠(docs/dialysis-order-design.md §5.1・§5.2) ----

export interface DialysisUnitsResult {
  groups: DialysisUnitGroup[];
  /** ベッドの Location.id → そのベッドの枠表。 */
  schedulesByBedId: Map<string, fhir4.Schedule>;
}

async function fetchDialysisUnits(): Promise<DialysisUnitsResult> {
  const locationParams = new URLSearchParams();
  locationParams.set("type", DIALYSIS_LOCATION_TYPE.code);
  const scheduleParams = new URLSearchParams();
  scheduleParams.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|dialysis`);
  // 透析室の設定とボードの格子に使うので、欠けた結果は使わない。
  const [locations, schedules] = await Promise.all([
    searchAllPages<fhir4.Location>("Location", locationParams, { page: 500, maxPages: 2, complete: true }),
    searchAllPages<fhir4.Schedule>("Schedule", scheduleParams, { page: 500, maxPages: 2, complete: true }),
  ]);
  const schedulesByBedId = new Map<string, fhir4.Schedule>();
  for (const schedule of schedules.matches) {
    const bedId = scheduleBedId(schedule);
    if (bedId && !schedulesByBedId.has(bedId)) schedulesByBedId.set(bedId, schedule);
  }
  return { groups: groupDialysisLocations(locations.matches), schedulesByBedId };
}

export function useDialysisUnits() {
  return useQuery({ queryKey: ["Location", "dialysis-unit"], queryFn: fetchDialysisUnits });
}

/** 透析室・ベッド・枠表をまとめて書く(transaction はヘルパーが組む)。 */
export function useSaveDialysisUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
      queryClient.invalidateQueries({ queryKey: ["Schedule"] });
    },
  });
}

/** 枠表(カンマ OR)の期間の枠。状態は問わない。 */
async function fetchDialysisSlots(
  scheduleIds: readonly string[],
  from: string,
  to: string,
): Promise<fhir4.Slot[]> {
  if (scheduleIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set("schedule", scheduleIds.map((id) => `Schedule/${id}`).join(","));
  params.append("start", `ge${from}`);
  // 終了日を含めたいので翌日未満で切る。
  params.append("start", `lt${addDays(to, 1)}`);
  params.set("_sort", "start");
  const { matches } = await searchAllPages<fhir4.Slot>("Slot", params, { page: 500, maxPages: 40, complete: true });
  return matches;
}

const SLOT_CHUNK = 200;

/**
 * 有効なベッドの枠を、期間の日 × シフトで作る。既にある日 × シフトは作らない(generateDialysisSlots)。
 * 件数が多いので 200 件ずつの transaction に分けて送る(枠表の一括生成と同じ)。
 */
export function useGenerateDialysisSlots() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      schedules,
      shifts,
      from,
      to,
    }: {
      schedules: fhir4.Schedule[];
      shifts: DialysisShift[];
      from: string;
      to: string;
    }) => {
      const ids = schedules.flatMap((schedule) => (schedule.id ? [schedule.id] : []));
      const existing = await fetchDialysisSlots(ids, from, to);
      const slots = ids.flatMap((id) =>
        generateDialysisSlots(
          id,
          shifts,
          from,
          to,
          existing.filter((slot) => slot.schedule.reference === `Schedule/${id}`),
        ),
      );
      for (let i = 0; i < slots.length; i += SLOT_CHUNK) {
        await postBundle(buildSlotCreateBundle(slots.slice(i, i + SLOT_CHUNK)));
      }
      return slots.length;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["Slot"] }),
  });
}

/** ボード・展開のプレビューに使う、ベッドの枠表の期間の枠。 */
export function useDialysisSlots(scheduleIds: readonly string[], from: string, to: string) {
  const ids = [...scheduleIds].sort();
  return useQuery({
    queryKey: ["Slot", "dialysis", ids.join(","), from, to],
    queryFn: () => fetchDialysisSlots(ids, from, to),
    enabled: ids.length > 0 && Boolean(from) && Boolean(to) && from <= to,
    placeholderData: keepPreviousData,
  });
}

// ---- 透析一覧(部門ワークリスト) ----
//
// リハビリ一覧と同じく、基準日に効いている(始まっていて、まだ終わっていない)オーダーを order-period で引く。
// 浄化方法・入外・進捗などの絞り込みは画面側で行う。

export interface DialysisWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 進捗(= 部門の受け入れ状態)。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** 基準日以降の有効な予約(近い順)。先頭が「次回」。 */
  appointments: fhir4.Appointment[];
}

export interface DialysisWorklistResult {
  rows: DialysisWorklistRow[];
  truncated: boolean;
}

function dialysisWorklistParams(date: string, page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${DIALYSIS_ORDER_TYPE.code}`);
  // 中止したオーダー(revoked)も並べる(中止取消はこの一覧から行う)。
  params.set("status", "active,revoked");
  setOrderPeriod(params, date, date);
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

/** 基準日以降の有効な透析予約を、オーダーの id ごとに(それぞれ日時の近い順)。 */
async function fetchDialysisAppointmentsFrom(from: string): Promise<Truncatable<Map<string, fhir4.Appointment[]>>> {
  const params = new URLSearchParams();
  params.set("date", `ge${from}`);
  params.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|dialysis`);
  setActiveAppointmentStatus(params);
  params.set("_sort", "date");
  const { matches, truncated } = await searchAllPages<fhir4.Appointment>("Appointment", params, {
    page: 500,
    maxPages: 4,
  });
  const byOrderId = new Map<string, fhir4.Appointment[]>();
  for (const appointment of matches) {
    const orderId = appointmentOrderId(appointment);
    if (!orderId) continue;
    const list = byOrderId.get(orderId);
    if (list) list.push(appointment);
    else byOrderId.set(orderId, [appointment]);
  }
  return { value: byOrderId, truncated };
}

async function fetchDialysisWorklist(date: string): Promise<DialysisWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => dialysisWorklistParams(date, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isDialysisServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );
  const appointments = await fetchDialysisAppointmentsFrom(date);
  const taskByOrderId = dialysisTasksByOrderId(tasks);
  const rows = orders.map((order) => ({
    order,
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
    appointments: appointments.value.get(order.id ?? "") ?? [],
  }));
  rows.sort(comparePatientNumber);
  return { rows, truncated: truncated || appointments.truncated };
}

/** 基準日に効いている透析オーダー。 */
export function useDialysisWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "dialysis-worklist", date],
    queryFn: () => fetchDialysisWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

// ---- 当日ボード・週 ----

export interface DialysisBoardResult {
  /** 期間の予約(取消・未来院を除く。実施済も含む)。 */
  appointments: fhir4.Appointment[];
  patientsById: Map<string, fhir4.Patient>;
  ordersById: Map<string, fhir4.ServiceRequest>;
  truncated: boolean;
}

/** ボードに出す予約の status。実施済(fulfilled)もボードに残す(setActiveAppointmentStatus は除くので使わない)。 */
const BOARD_APPOINTMENT_STATUSES = "booked,arrived,checked-in,fulfilled";

async function fetchDialysisBoard(from: string, to: string): Promise<DialysisBoardResult> {
  const params = new URLSearchParams();
  params.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|dialysis`);
  params.append("date", `ge${from}`);
  params.append("date", `lt${addDays(to, 1)}`);
  params.set("status", BOARD_APPOINTMENT_STATUSES);
  params.append("_include", "Appointment:patient");
  params.append("_include", "Appointment:based-on");
  const { matches, bundles, truncated } = await searchAllPages<fhir4.Appointment>("Appointment", params, {
    page: 500,
    maxPages: 4,
  });
  const patientsById = new Map<string, fhir4.Patient>();
  const ordersById = new Map<string, fhir4.ServiceRequest>();
  for (const bundle of bundles) {
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (!resource?.id) continue;
      if (resource.resourceType === "Patient") patientsById.set(resource.id, resource as fhir4.Patient);
      if (resource.resourceType === "ServiceRequest") ordersById.set(resource.id, resource as fhir4.ServiceRequest);
    }
  }
  return { appointments: matches, patientsById, ordersById, truncated };
}

/** from〜to(両端を含む)の透析予約。当日ボードは 1 日、週ビューは 7 日。 */
export function useDialysisBoard(from: string, to: string) {
  return useQuery({
    queryKey: ["Appointment", "dialysis-board", from, to],
    queryFn: () => fetchDialysisBoard(from, to),
    enabled: Boolean(from) && Boolean(to),
    placeholderData: keepPreviousData,
  });
}

// ---- 実施記録(docs/dialysis-order-design.md §6) ----

export interface DialysisSessionsResult {
  sessions: DialysisSession[];
  /** 経過表のある回(実施記録のハブの id)。経過表のハブは Procedure:part-of の逆引きで同じ応答に乗る。 */
  chartSessionIds: Set<string>;
  truncated: boolean;
}

/** ハブと子(測定値・薬剤・追加の手技)を同じ応答に揃える。 */
function appendSessionRevincludes(params: URLSearchParams) {
  params.append("_revinclude", "Observation:part-of");
  params.append("_revinclude", "MedicationAdministration:part-of");
  params.append("_revinclude", "Procedure:part-of");
}

/**
 * from〜to(両端を含む)に始めた回と、日付を問わず終わっていない回(入室・透析中)。
 * 入室の段階のハブは開始時刻を持たず日付で引けないので、状態で別に引く。
 */
async function fetchDialysisSessions(from: string, to: string): Promise<DialysisSessionsResult> {
  const category = `${ORDER_TYPE_SYSTEM}|${DIALYSIS_ORDER_TYPE.code}`;
  const dated = new URLSearchParams();
  dated.set("category", category);
  dated.append("date", `ge${from}`);
  dated.append("date", `lt${addDays(to, 1)}`);
  appendSessionRevincludes(dated);
  const open = new URLSearchParams();
  open.set("category", category);
  open.set("status", "preparation,in-progress");
  appendSessionRevincludes(open);

  const options = { page: 500, maxPages: 4 };
  const results = await Promise.all([
    searchAllPages<fhir4.Procedure>("Procedure", dated, options),
    searchAllPages<fhir4.Procedure>("Procedure", open, options),
  ]);
  const resources = results.flatMap((result) => result.bundles.flatMap((bundle) => bundle.entry ?? []))
    .flatMap((entry) => (entry.resource ? [entry.resource] : []));
  const ofType = <T extends fhir4.Resource>(type: T["resourceType"]) =>
    resources.filter((resource): resource is T => resource.resourceType === type);
  const procedures = ofType<fhir4.Procedure>("Procedure");
  return {
    sessions: groupDialysisSessions(
      procedures,
      ofType<fhir4.Observation>("Observation"),
      ofType<fhir4.MedicationAdministration>("MedicationAdministration"),
    ),
    chartSessionIds: dialysisChartSessionIds(procedures),
    truncated: results.some((result) => result.truncated),
  };
}

export function useDialysisSessions(from: string, to: string) {
  return useQuery({
    queryKey: ["Procedure", "dialysis-sessions", from, to],
    queryFn: () => fetchDialysisSessions(from, to),
    enabled: Boolean(from) && Boolean(to),
    placeholderData: keepPreviousData,
  });
}

/** 実施を書いたあとに読み直すもの。予約の状態とカルテのカード(実施の表示)、ドライウェイト、経過表。 */
function invalidateDialysisPerform(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["Procedure"] });
  queryClient.invalidateQueries({ queryKey: ["Observation"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
  invalidateDialysisAppointments(queryClient);
}

/**
 * 入室・開始・終了(transaction はヘルパーが組む)。進捗 Task は動かさない。
 */
export function useDialysisPerform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSettled: () => invalidateDialysisPerform(queryClient),
  });
}

/**
 * 実施取消。その回の透析経過表があれば一緒に消す(実施しなかった回の経過表は残さない。
 * docs/dialysis-chart-design.md §2.3)。経過表は実施記録の応答に乗らないので、ここで読んでから組む。
 */
export function useCancelDialysisPerform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ session, appointment }: { session: DialysisSession; appointment?: fhir4.Appointment }) => {
      const chart = await fetchDialysisChart(session.hub.id ?? "");
      return postBundle(
        buildDialysisPerformDeleteBundle(session, appointment, chart ? buildDialysisChartDeleteEntries(chart) : []),
      );
    },
    onSettled: () => invalidateDialysisPerform(queryClient),
  });
}

// ---- 透析経過表(docs/dialysis-chart-design.md) ----

/** 1 回の実施記録(ハブと子)と、そのオーダー。経過表のページの見出しに使う。 */
export interface DialysisSessionDetail {
  session: DialysisSession;
  order: fhir4.ServiceRequest;
}

async function fetchDialysisSessionDetail(sessionId: string): Promise<DialysisSessionDetail | null> {
  const params = new URLSearchParams();
  params.set("_id", sessionId);
  params.set("_count", "100");
  appendSessionRevincludes(params);
  const { data } = await searchResource<fhir4.Resource>("Procedure", params);
  const session = groupDialysisSessions(
    resourcesOfType<fhir4.Procedure>(data, "Procedure"),
    resourcesOfType<fhir4.Observation>(data, "Observation"),
    resourcesOfType<fhir4.MedicationAdministration>(data, "MedicationAdministration"),
  ).find((candidate) => candidate.hub.id === sessionId);
  if (!session) return null;
  const orderId = dialysisSessionOrderId(session);
  const order = orderId ? (await readResource<fhir4.ServiceRequest>("ServiceRequest", orderId)).data : null;
  return order ? { session, order } : null;
}

export function useDialysisSessionDetail(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "dialysis-session", sessionId],
    queryFn: () => fetchDialysisSessionDetail(sessionId ?? ""),
    enabled: Boolean(sessionId),
  });
}

/**
 * 実施記録のハブにぶら下がる経過表(1 回に 1 件)。ハブは part-of で引き、打点・イベント・薬剤は全件読む。
 * 無ければ null(最初の打点でハブを作る)。
 */
export async function fetchDialysisChart(sessionId: string): Promise<DialysisChartData | null> {
  const params = new URLSearchParams();
  params.set("part-of", `Procedure/${sessionId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${DIALYSIS_CHART_TYPE.code}`);
  params.set("_count", "10");
  const { data } = await searchResource<fhir4.Procedure>("Procedure", params);
  const hub = resourcesOfType<fhir4.Procedure>(data, "Procedure").find(
    (procedure) => isDialysisChartHub(procedure) && procedure.status !== "entered-in-error",
  );
  if (!hub?.id) return null;
  const [observations, administrations] = await Promise.all([
    fetchAllByPartOf<fhir4.Observation>("Observation", hub.id),
    fetchAllByPartOf<fhir4.MedicationAdministration>("MedicationAdministration", hub.id),
  ]);
  return buildDialysisChartData(hub, observations, administrations);
}

export function useDialysisChart(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "dialysis-chart", sessionId],
    queryFn: () => fetchDialysisChart(sessionId ?? ""),
    enabled: Boolean(sessionId),
  });
}

/**
 * オーダーの回のうち、経過表のある回(実施記録のハブの id)。カルテの実施の行に「経過表あり」の印を出す。
 * 経過表のハブは basedOn を持たず(§2.2)オーダーの詳細に乗らないので、実施記録のハブを辿るチェーン検索で引く。
 * 新しい順に読むので、欠けるのは古い回の印だけ。
 */
export function useDialysisChartSessionIds(orderId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "dialysis-chart-sessions", orderId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("category", `${ORDER_TYPE_SYSTEM}|${DIALYSIS_CHART_TYPE.code}`);
      params.set("part-of:Procedure.based-on", `ServiceRequest/${orderId}`);
      params.set("status:not", "entered-in-error");
      params.set("_sort", "-date");
      params.set("_elements", "category,partOf,status");
      const { matches, truncated } = await searchAllPages<fhir4.Procedure>("Procedure", params, {
        page: 500,
        maxPages: 4,
        strict: true,
      });
      return { ids: dialysisChartSessionIds(matches), truncated };
    },
    enabled: Boolean(orderId),
  });
}

/** 経過表への書き込み。打点は 1 時点の組を 1 transaction で書き、途中失敗で組が欠けないようにする。 */
export function useDialysisChartWrite(sessionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entries: fhir4.BundleEntry[]) =>
      postBundle({ resourceType: "Bundle", type: "transaction", entry: entries }),
    onSuccess: (_data, entries) => {
      queryClient.invalidateQueries({ queryKey: ["Procedure", "dialysis-chart", sessionId] });
      // ハブを作った・消したときだけ、「経過表あり」の印を出す一覧を読み直させる(打点の追加では変わらない)。
      if (entries.some((entry) => entry.request?.url.split("/")[0] === "Procedure")) {
        queryClient.invalidateQueries({ queryKey: ["Procedure", "dialysis-chart-sessions"] });
        queryClient.invalidateQueries({ queryKey: ["Procedure", "dialysis-sessions"] });
      }
    },
  });
}

// ---- 予約(一括展開・臨時・変更) ----

/** オーダーの予約(有効なものと実施済み)。展開の開始日・除外・前回のベッドの初期値に使う。 */
export function useDialysisOrderAppointments(orderId: string | undefined) {
  return useQuery({
    queryKey: ["Appointment", "dialysis-order", orderId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("based-on", `ServiceRequest/${orderId}`);
      params.set("status", [...ACTIVE_APPOINTMENT_STATUSES, "fulfilled"].join(","));
      params.set("_sort", "date");
      // 除外の判定に使うので欠けた結果は使わない。
      const { matches } = await searchAllPages<fhir4.Appointment>("Appointment", params, {
        page: 500,
        maxPages: 4,
        complete: true,
        strict: true,
      });
      return matches;
    },
    enabled: Boolean(orderId),
  });
}

function invalidateDialysisAppointments(queryClient: QueryClient) {
  invalidateAppointments(queryClient);
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "dialysis-worklist"] });
}

/** 一括展開・臨時の予約。どちらも 1 transaction(先に取られた枠があれば 412 で全体が落ちる)。 */
export function useBookDialysisAppointments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      patient,
      orderId,
      bookings,
    }: {
      patient: fhir4.Patient;
      orderId: string;
      bookings: DialysisBooking[];
    }) => postBundle(buildDialysisAppointmentBatchBundle(patient, orderId, bookings)),
    // 412 のときも枠の空きを読み直す。
    onSettled: () => invalidateDialysisAppointments(queryClient),
  });
}

/** 予約を別のベッド・日・シフトへ移す。 */
export function useRescheduleDialysisAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ appointment, booking }: { appointment: fhir4.Appointment; booking: DialysisBooking }) =>
      postBundle(buildDialysisRescheduleBundle(appointment, await fetchAppointmentSlots(appointment), booking)),
    onSettled: () => invalidateDialysisAppointments(queryClient),
  });
}

// ---- 進捗 ----

/**
 * 受付・終了・中止などの進捗を書き込む(リハビリの useUpdateRehabTaskStatus と同じ)。
 * 終了はオーダーに終了日を書き、終了日の翌日以降の予約を同じ transaction で取り消す。中止は今日以降の予約を取り消す。
 * 過ぎた予約は通院の記録なので残す。終了取消・中止取消で予約は戻さない。
 */
export function useUpdateDialysisTaskStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      order,
      task,
      status,
      endDate,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: DialysisTaskStatus;
      /** 終了日。status が completed のときだけ使う。 */
      endDate?: string;
    }) => {
      const entry: fhir4.BundleEntry[] = [taskBundleEntry(buildDialysisTaskUpdate(task, order, status))];
      if (status === "completed" && endDate) {
        entry.push(buildDialysisOrderCloseEntry(order, endDate));
        entry.push(...(await fetchOrderAppointmentCancelEntries(order.id ?? "", { from: addDays(endDate, 1) })));
      } else {
        entry.push(...orderCancelEntries(order, status === "cancelled"));
        if (status === "cancelled") {
          entry.push(...(await fetchOrderAppointmentCancelEntries(order.id ?? "", { from: today() })));
        }
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    onSuccess: (_result, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "dialysis-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Task", "search"] });
      if (status === "completed" || status === "cancelled") invalidateAppointments(queryClient);
    },
  });
}
