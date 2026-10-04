import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { nowFhirDateTime } from "../../lib/dates";
import { buildEncounterUpdateBundle } from "../../fhir/encounterHelpers";
import { orderDay, referenceId } from "../../fhir/shared";
import { buildInjectionTaskUpdate, injectionTasksByOrderId, type InjectionTaskStatus } from "../../fhir/injectionTaskHelpers";
import { buildInjectionPerformDeleteEntries, type InjectionPerformDisplay } from "../../fhir/injectionPerformHelpers";
import {
  buildInjectionSeriesDeleteBundle,
  INJECTION_ORDER_TYPE,
  INJECTION_SERIES_SYSTEM,
  type InjectionDayTarget,
  injectionSeriesOf,
} from "../../fhir/injectionHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { appointmentActorId, isExamAppointment, withCheckedInAt } from "../../fhir/appointmentHelpers";
import {
  EXAM_IN_PROGRESS_STATUS,
  latestExamByAppointment,
  OUTPATIENT_CLASS_CODE,
  outpatientEncounterAppointmentId,
} from "../../fhir/outpatientEncounterHelpers";
import {
  outpatientOrderSummaries,
  type OutpatientOrderSummary,
} from "../../fhir/outpatientOrderProgressHelpers";
import { createResource, postBundle, readResource, searchResource } from "../fhirClient";
import { invalidateAppointments, orderAppointmentCancelEntries } from "./appointment";
import { makeOrderDetailHook, ORDER_ITEM_REVINCLUDES } from "./core";
import { makePerformDetailHook, taskBundleEntry } from "./worklist";

// ---- 外来一覧(受付ワークリスト) ----
//
// 診察日 1 日ぶんの予約を読み、診療科・医師・診察室・状態での絞り込みは画面側で行う。
// 上流は specialty や actor でも検索できるが、1 日ぶんなら数十件なので、全件読んで
// から絞る方が絞り込みの切り替えで結果がぶれない(放射線検査一覧と同じ理由)。

const OUTPATIENT_PAGE = 500;
// 1 日の予約がこの件数を超えることは想定していない。超えた場合は読むのをやめ、
// 画面に「一部のみ」と出す(黙って切り捨てると全件見えているように見えるため)。
const OUTPATIENT_MAX_PAGES = 2;

/** 外来一覧の 1 行。予約(Appointment)1 件ぶん。 */
export interface OutpatientRow {
  appointment: fhir4.Appointment;
  patient?: fhir4.Patient;
  /** この予約の診察(外来 Encounter)。診察が始まっていなければ無い。 */
  encounter?: fhir4.Encounter;
}

export interface OutpatientListResult {
  rows: OutpatientRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

/**
 * その日の外来の診察(Encounter)を予約 id ごとに引く。
 *
 * status では絞らない(診察中と診察終了の両方が要る)。取り消した診察開始
 * (entered-in-error)は latestExamByAppointment が落とす — 上流の Encounter が
 * status:not 修飾子に応えるか未確認なので、画面側で落とす方を採る。
 *
 * 予約からの逆引き(Encounter.appointment 検索)は使わず、入院一覧と同じ
 * 「日付 + class」で 1 日ぶんを読んでから突き合わせる(上流の対応状況に依存しない)。
 */
async function fetchOutpatientExams(date: string): Promise<Map<string, fhir4.Encounter>> {
  const encounters: fhir4.Encounter[] = [];

  for (let page = 0; page < OUTPATIENT_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("class", OUTPATIENT_CLASS_CODE);
    // 同じ名前を 2 回渡すと AND(期間の重なり)になる。fetchInpatients と同じ手。
    params.append("date", `ge${date}`);
    params.append("date", `le${date}`);
    params.set("_count", String(OUTPATIENT_PAGE));
    params.set("_offset", String(page * OUTPATIENT_PAGE));

    const { data: bundle } = await searchResource<fhir4.Encounter>("Encounter", params);
    const matched =
      bundle.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Encounter => r?.resourceType === "Encounter") ?? [];
    encounters.push(...matched);
    if (matched.length < OUTPATIENT_PAGE) break;
  }

  return latestExamByAppointment(encounters);
}

async function fetchOutpatientList(date: string): Promise<OutpatientListResult> {
  const appointments: fhir4.Appointment[] = [];
  const patientsById = new Map<string, fhir4.Patient>();
  let truncated = false;

  for (let page = 0; page < OUTPATIENT_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    // R4 の date は Appointment.start。上流はタイムゾーンを持たない検索値を自身の
    // ローカルタイムゾーン(Asia/Tokyo)で解釈するので、日付をそのまま渡せば
    // 「その日」になる(/metadata の implementation.description に設定が出る)。
    params.set("date", date);
    // 取消・誤登録はその日の外来から外れたものなので上流で落とす。
    params.set("status:not", "cancelled,entered-in-error");
    params.set("_count", String(OUTPATIENT_PAGE));
    params.set("_offset", String(page * OUTPATIENT_PAGE));
    // 患者番号を出すのに患者の現物が要る。
    params.set("_include", "Appointment:patient");

    const { data: bundle } = await searchResource<fhir4.Resource>("Appointment", params);

    let matched = 0;
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (resource?.resourceType === "Appointment") {
        appointments.push(resource as fhir4.Appointment);
        matched += 1;
      } else if (resource?.resourceType === "Patient" && resource.id) {
        patientsById.set(resource.id, resource as fhir4.Patient);
      }
    }

    if (matched < OUTPATIENT_PAGE) break;
    if (page === OUTPATIENT_MAX_PAGES - 1) truncated = true;
  }

  const examByAppointment = await fetchOutpatientExams(date);

  const rows = appointments
    // 検査予約(オーダーにぶら下がる予約)の受付・実施は部門のワークリストが追うので
    // 外来一覧には出さない。これだけは検索パラメータで表せないので画面側で落とす。
    .filter((appointment) => !isExamAppointment(appointment))
    .map((appointment) => ({
      appointment,
      patient: patientsById.get(appointmentActorId(appointment, "Patient")),
      encounter: appointment.id ? examByAppointment.get(appointment.id) : undefined,
    }));

  // 診察の順に並べたいので開始時刻の早い順(予約タブの新しい順とは逆)。
  rows.sort((a, b) => (a.appointment.start ?? "").localeCompare(b.appointment.start ?? ""));

  return { rows, truncated };
}

/** 外来一覧の自動更新の間隔。 */
export const OUTPATIENT_POLLING_INTERVAL = 60_000;

/**
 * 診察日 1 日ぶんの予約。日付が未選択の間は読みに行かない。
 *
 * polling を入れると 1 分ごとに読み直す(受付・診察室・会計が別の端末で同じ一覧を
 * 見るため)。
 */
export function useOutpatientList(date: string, options: { polling?: boolean } = {}) {
  return useQuery({
    queryKey: ["Appointment", "outpatient", date],
    queryFn: () => fetchOutpatientList(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
    refetchInterval: options.polling ? OUTPATIENT_POLLING_INTERVAL : false,
  });
}

// ---- 当日オーダーの進み具合 ----
//
// 一覧に載っている患者ぶんだけ、その日のオーダー(ヘッダ)を進捗の Task・検査結果・
// 実施記録と一緒に引く。患者を塊に分けて並列に引く(URL が長くなりすぎないように)。

const ORDER_PATIENT_CHUNK = 40;

async function fetchOutpatientOrders(
  date: string,
  patientIds: string[],
): Promise<Map<string, OutpatientOrderSummary[]>> {
  const orders: fhir4.ServiceRequest[] = [];
  const tasks: fhir4.Task[] = [];
  const reports: fhir4.DiagnosticReport[] = [];
  const performs: fhir4.Procedure[] = [];

  const chunks: string[][] = [];
  for (let i = 0; i < patientIds.length; i += ORDER_PATIENT_CHUNK) {
    chunks.push(patientIds.slice(i, i + ORDER_PATIENT_CHUNK));
  }
  const bundles = await Promise.all(
    chunks.map((ids) => {
      const params = new URLSearchParams();
      params.set("subject", ids.map((id) => `Patient/${id}`).join(","));
      params.set("occurrence", date);
      // 明細はオーダーそのものではないので、ヘッダだけにする。
      params.set("based-on:missing", "true");
      params.set("_count", "500");
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "DiagnosticReport:based-on");
      params.append("_revinclude", "Procedure:based-on");
      return searchResource<fhir4.Resource>("ServiceRequest", params);
    }),
  );
  for (const { data: bundle } of bundles) {
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (resource?.resourceType === "ServiceRequest") orders.push(resource as fhir4.ServiceRequest);
      else if (resource?.resourceType === "Task") tasks.push(resource as fhir4.Task);
      else if (resource?.resourceType === "DiagnosticReport") reports.push(resource as fhir4.DiagnosticReport);
      else if (resource?.resourceType === "Procedure") performs.push(resource as fhir4.Procedure);
    }
  }

  return outpatientOrderSummaries(orders, tasks, reports, performs, date);
}

/**
 * 一覧の患者ぶんの当日オーダー。患者 id → 種別ごとの印。
 * 一覧と同じく polling を入れると 1 分ごとに読み直す。
 */
export function useOutpatientOrders(
  date: string,
  patientIds: string[],
  options: { polling?: boolean } = {},
) {
  const key = [...new Set(patientIds)].sort().join(",");
  const query = useQuery({
    queryKey: ["ServiceRequest", "outpatient-orders", date, key],
    queryFn: () => fetchOutpatientOrders(date, key.split(",")),
    enabled: Boolean(date) && key.length > 0,
    placeholderData: keepPreviousData,
    refetchInterval: options.polling ? OUTPATIENT_POLLING_INTERVAL : false,
  });
  return { ...query, byPatient: query.data ?? new Map<string, OutpatientOrderSummary[]>() };
}

/**
 * 受付・受付取消を予約の status に書き込む。transaction Bundle で書き、一覧が読んだ
 * Appointment の版は postBundle が ifMatch に添える。
 *
 * 受付では受付時刻も一緒に残す(予約時間とは別の列で出すため)。受付取消では
 * 消して、受付していない予約に受付時刻が残らないようにする。
 */
export function useUpdateAppointmentStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      appointment,
      status,
    }: {
      appointment: fhir4.Appointment;
      status: fhir4.Appointment["status"];
    }) => {
      // BundleEntry.resource は基底の Resource 型なので、更新後の予約は
      // Appointment として組んでから渡す(直接書くと status が余剰プロパティに
      // なる)。appointmentHelpers の slotEntry と同じ形。
      const updated: fhir4.Appointment = withCheckedInAt(
        { ...appointment, status },
        status === "checked-in" ? nowFhirDateTime() : "",
      );

      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          {
            resource: updated,
            request: { method: "PUT", url: `Appointment/${appointment.id}` },
          },
        ],
      });
    },
    onSuccess: () => invalidateAppointments(queryClient),
  });
}

// ---- 診察の開始・終了(外来 Encounter) ----
//
// 診察中は Appointment.status では表せないので、診察開始で外来 Encounter を建てる
// (理由は fhir/outpatientEncounterHelpers.ts の冒頭)。診察を書き換えるときに予約も
// 一緒に動かすものは、片方だけが通ることのないよう必ず同じ transaction に載せる。

function invalidateOutpatientExams(queryClient: QueryClient) {
  invalidateAppointments(queryClient);
  queryClient.invalidateQueries({ queryKey: ["Encounter"] });
}

/** 診察開始。予約は受付済(checked-in)のままなので触らない。 */
export function useStartOutpatientExam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (encounter: fhir4.Encounter) => createResource(encounter),
    onSuccess: () => invalidateOutpatientExams(queryClient),
  });
}

/**
 * 診察を書き換える。診察終了(Encounter を finished + 予約を fulfilled)・
 * 診察終了の取消(in-progress + checked-in)・診察開始の取消(entered-in-error、
 * 予約は据え置き)をこれ 1 本で賄う。
 *
 * 予約も動かすときは appointment を渡す。診察だけが進んで予約が受付済のまま、
 * といった食い違いを作らないよう 1 本の transaction で書く。
 */
export function useUpdateOutpatientExam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      encounter,
      appointment,
      appointmentStatus,
    }: {
      encounter: fhir4.Encounter;
      appointment?: fhir4.Appointment;
      appointmentStatus?: fhir4.Appointment["status"];
    }) => {
      const extraEntries: fhir4.BundleEntry[] = [];
      if (appointment && appointmentStatus) {
        // BundleEntry.resource は基底の Resource 型なので、更新後の予約は
        // Appointment として組んでから渡す(useUpdateAppointmentStatus と同じ)。
        const updated: fhir4.Appointment = { ...appointment, status: appointmentStatus };
        extraEntries.push({
          resource: updated,
          request: { method: "PUT", url: `Appointment/${appointment.id}` },
        });
      }
      return postBundle(buildEncounterUpdateBundle(encounter, extraEntries));
    },
    onSuccess: () => invalidateOutpatientExams(queryClient),
  });
}

/**
 * 受付内容(診療科・担当医・診察室)の変更。外来一覧のケバブメニューから、受付の
 * 前後を問わず変えられるようにするためのもの。
 *
 * 診察が始まっている予約では、診察の Encounter が持つ担当医・診察室も一緒に
 * 書き換える(予約だけ変わって診察の記録が前のままになるのを防ぐため、同じ
 * transaction に載せる)。一覧は検索結果のリソースを持っているだけで ETag が
 * 無いため、単体 PUT ではなく Bundle で書く(useUpdateAppointmentStatus と同じ)。
 */
export function useUpdateOutpatientReception() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      appointment,
      encounter,
    }: {
      appointment: fhir4.Appointment;
      encounter?: fhir4.Encounter;
    }) => {
      const entry: fhir4.BundleEntry[] = [
        {
          resource: appointment,
          request: { method: "PUT", url: `Appointment/${appointment.id}` },
        },
      ];
      if (encounter) {
        entry.push({
          resource: encounter,
          request: { method: "PUT", url: `Encounter/${encounter.id}` },
        });
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    onSuccess: () => invalidateOutpatientExams(queryClient),
  });
}

/** カルテのヘッダに「診察終了」を出すのに要るもの。 */
export interface OutpatientExam {
  encounter: fhir4.Encounter;
  /** 診察のもとになった予約。診察終了で fulfilled に書き換えるので現物が要る。 */
  appointment?: fhir4.Appointment;
}

async function fetchPatientOutpatientExam(patientId: string): Promise<OutpatientExam | null> {
  const params = new URLSearchParams();
  params.set("subject", `Patient/${patientId}`);
  params.set("status", EXAM_IN_PROGRESS_STATUS);
  params.set("class", OUTPATIENT_CLASS_CODE);
  params.set("_count", "10");

  const { data: bundle } = await searchResource<fhir4.Encounter>("Encounter", params);
  const encounters =
    bundle.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Encounter => r?.resourceType === "Encounter") ?? [];
  // 同じ患者の診察が 2 件並ぶことは無い想定だが、あれば開始が新しい方を採る
  // (データがおかしくてもカルテの見出しが壊れないように)。
  const encounter = encounters.reduce<fhir4.Encounter | undefined>(
    (latest, current) =>
      !latest || (current.period?.start ?? "") > (latest.period?.start ?? "") ? current : latest,
    undefined,
  );
  if (!encounter) return null;

  const appointmentId = outpatientEncounterAppointmentId(encounter);
  if (!appointmentId) return { encounter };
  const { data: appointment } = await readResource<fhir4.Appointment>(
    "Appointment",
    appointmentId,
  );
  return { encounter, appointment };
}

/** その患者がいま診察中ならその診察。診察中でなければ null。 */
export function usePatientOutpatientExam(patientId: string | undefined) {
  return useQuery({
    queryKey: ["Encounter", "patient-outpatient-exam", patientId],
    queryFn: () => fetchPatientOutpatientExam(patientId as string),
    enabled: Boolean(patientId),
  });
}

/** 当日受付。枠を持たない予約を受付済で登録する(buildWalkInAppointment を参照)。 */
export function useWalkInCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (appointment: fhir4.Appointment) => createResource(appointment),
    onSuccess: () => invalidateAppointments(queryClient),
  });
}

export function usePrescriptionDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);
  params.append("_revinclude", "MedicationRequest:based-on");
  // 注射の詳細に進捗(依頼済・中止…)を出すため、Task も同じ応答で受け取る。
  params.append("_revinclude", "Task:focus");

  return useQuery({
    queryKey: ["ServiceRequest", "detail", srId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

// 連日オーダーの後続日。編集中・削除中の注射と同じ束ね(requisition)で、その日より
// 後の注射日のオーダーを注射日の順に薬剤ごと返す。一括で展開できるのは 14 日までなので
// _count は余裕を見た固定値で足りる。
// 注射日は occurrence(登録日時 authoredOn ではない。同時に展開した日はすべて同じ
// 登録日時を持つので、authoredOn では後続日を区別できない)。
export function useInjectionSeriesLater(sr: fhir4.ServiceRequest | undefined) {
  const series = sr ? injectionSeriesOf(sr) : null;
  const patientId = referenceId(sr?.subject?.reference);
  const date = sr ? orderDay(sr) : "";
  const params = new URLSearchParams();
  if (patientId) params.set("patient", patientId);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${INJECTION_ORDER_TYPE.code}`);
  if (series) params.set("requisition", `${INJECTION_SERIES_SYSTEM}|${series.requisition}`);
  if (date) params.set("occurrence", `gt${date}`);
  params.set("_sort", "occurrence");
  params.append("_revinclude", "MedicationRequest:based-on");
  // 中止を「この日以降」まとめて書くとき、後続日に既にある Task が要る
  // (status だけだと Task を二重に作ってしまう)。
  params.append("_revinclude", "Task:focus");
  params.set("_count", "100");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "injection-series-later", sr?.id],
    queryFn: async (): Promise<InjectionDayTarget[]> => {
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const resources = (bundle.entry ?? []).map((e) => e.resource).filter(Boolean);
      const mrsBySr = new Map<string, fhir4.MedicationRequest[]>();
      for (const r of resources) {
        if (r?.resourceType !== "MedicationRequest") continue;
        const mr = r as fhir4.MedicationRequest;
        const parent = referenceId(mr.basedOn?.[0]?.reference);
        if (!parent) continue;
        mrsBySr.set(parent, [...(mrsBySr.get(parent) ?? []), mr]);
      }
      const taskBySr = injectionTasksByOrderId(
        resources.filter((r): r is fhir4.Task => r?.resourceType === "Task"),
      );
      return resources
        .filter((r): r is fhir4.ServiceRequest => r?.resourceType === "ServiceRequest")
        .filter((s) => s.id !== sr?.id)
        .map((s) => ({
          serviceRequest: s,
          medicationRequests: mrsBySr.get(s.id ?? "") ?? [],
          task: taskBySr.get(s.id ?? ""),
        }));
    },
    enabled: Boolean(sr && series && patientId && date),
  });
}

/**
 * 注射の進捗を書き込む。連日オーダーは「この日のみ」でも「この日以降すべて」でも
 * 同じ形(日ごとの Task)なので、対象の配列を受け取って 1 つの transaction で書く
 * (途中の日だけ中止済み、という half-done を作らない)。
 */
export function useUpdateInjectionTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      targets,
      status,
    }: {
      targets: { serviceRequest: fhir4.ServiceRequest; task: fhir4.Task | undefined }[];
      status: InjectionTaskStatus;
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: targets.map(({ serviceRequest, task }) =>
          taskBundleEntry(buildInjectionTaskUpdate(task, serviceRequest, status)),
        ),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "injection-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

/**
 * 注射の実施登録。実施記録一式と(予定回数に達したら)Task の実施済を 1 つの
 * transaction で書き込む。Bundle の組み立ては injectionPerformHelpers を参照。
 */
export function useRegisterInjectionPerform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

/**
 * 注射の実施取消。そのオーダーの実施記録をすべて消し、実施済になっていた Task は
 * 依頼済に戻す(払出済だったかは分からないので、いちばん手前に戻す)。
 * 記録を消す理由は buildInjectionPerformDeleteEntries を参照。
 */
export function useCancelInjectionPerforms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      order,
      task,
      performs,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      performs: InjectionPerformDisplay[];
    }) => {
      const entries = buildInjectionPerformDeleteEntries(performs);
      if (task?.id && task.status === "completed") {
        entries.push(taskBundleEntry(buildInjectionTaskUpdate(task, order, "requested")));
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry: entries });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

/**
 * 連日オーダーを複数日まとめて削除する。予約(化学療法の日オーダーに取ってある外来化学療法室)も
 * 一緒に取り消す —— オーダーが消えたのに枠が埋まったままになるのを防ぐ(§8.15 N-13)。
 *
 * useDeleteInjectionSeries の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteInjectionSeriesRequest = async (srIds: string[]) => {
  const bundle = buildInjectionSeriesDeleteBundle(srIds);
  const cancels = await orderAppointmentCancelEntries(srIds);
  return postBundle({ ...bundle, entry: [...(bundle.entry ?? []), ...cancels] });
};

export function useDeleteInjectionSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteInjectionSeriesRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      invalidateAppointments(queryClient);
    },
  });
}

// 検体検査オーダー。明細も ServiceRequest なので、ヘッダと一緒に
// パネルの構成項目(2 段目)まで 1 リクエストで受け取る。
export const useLabOrderDetail = makeOrderDetailHook("lab-order", ORDER_ITEM_REVINCLUDES);

// 細菌検査オーダーもヘッダ・検体グループ・検査項目が別リソースなので、
// 検体検査と同じ形で 1 リクエストにまとめて取る。
export const useMicroOrderDetail = makeOrderDetailHook("micro-order", ORDER_ITEM_REVINCLUDES);

// 放射線オーダーもヘッダと明細が別リソースなので、検体検査と同じ形で 1 リクエストに
// まとめて取る(明細は _revinclude:iterate で添えてもらう)。
export const useRadOrderDetail = makeOrderDetailHook("rad-order", ORDER_ITEM_REVINCLUDES);

export const useRadPerformDetail = makePerformDetailHook("rad-perform", { observations: true });
