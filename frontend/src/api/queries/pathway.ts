import {
  keepPreviousData,
  type QueryClient,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { buildPathwayApplyProvenanceEntry } from "../../fhir/provenanceHelpers";
import {
  parsePathwayApplication,
  PATHWAY_APPLY_ID_SYSTEM,
  PATHWAY_LEVEL_SYSTEM,
  PATHWAY_MARKER_CODE,
  PATHWAY_MARKER_SYSTEM,
  type PathwayApplicationRecord,
  pathwayInstantiatesUri,
} from "../../fhir/pathwayApplyHelpers";
import { PATHWAY_APPLY_GOAL_ID_SYSTEM } from "../../fhir/pathwayCloseHelpers";
import { parsePathwayWardTasks, type PathwayWardTask } from "../../fhir/pathwayWorklistHelpers";
import { type OrderProgress, orderProgressByOrderId } from "../../fhir/orderProgressHelpers";
import { PATHWAY_VARIANCE_TASK_CODE } from "../../fhir/pathwayVarianceHelpers";
import { ADMISSION_CLASS_CODE, PLANNED_STATUS, sortPlannedAdmissions } from "../../fhir/encounterHelpers";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { postBundle, readResource, searchResource } from "../fhirClient";
import { invalidateAppointments } from "./appointment";
import { deleteConsultOrderRequest, invalidateConsult } from "./consult";
import { NOTIFICATION_TASK_KEY, resourcesOfType } from "./core";
import { deleteEndoscopyOrderRequest } from "./endoscopy";
import { deleteLabOrderRequest } from "./lab";
import { deleteMealOrderRequest } from "./meal";
import { deleteMicroOrderRequest } from "./micro";
import { invalidateNursing } from "./nursing";
import { deleteNutritionGuidanceOrderRequest } from "./nutritionGuidance";
import { deleteInjectionSeriesRequest } from "./outpatient";
import { deletePathoOrderRequest } from "./patho";
import { deletePhysioOrderRequest } from "./physio";
import { deletePrescriptionRequest } from "./prescription";
import { invalidateProvenance, useOrderEnterer, useWithOrderProvenance } from "./provenance";
import { deleteRadOrderRequest } from "./rad";
import { deleteRadiotherapyOrderRequest } from "./radiotherapy";
import { deleteRehabOrderRequest } from "./rehab";
import { deleteSurgeryOrderRequest } from "./surgery";
import { deleteTransfusionOrderRequest } from "./transfusion";
import { deleteTreatmentOrderRequest } from "./treatment";

// ---- クリニカルパスの適用(docs/clinical-pathway-design.md §7) ----

function invalidatePathway(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["CarePlan"] });
  queryClient.invalidateQueries({ queryKey: ["Procedure"] });
}

/** 患者のパス適用(木の根)の一覧に出す要約。 */
export interface PathwayApplicationSummary {
  id: string;
  applyId: string;
  title: string;
  status: string;
  pathwayCode: string;
  encounterId: string;
  periodStart: string;
  periodEnd: string;
}

function summarizePathwayApplication(carePlan: fhir4.CarePlan): PathwayApplicationSummary {
  const prefix = pathwayInstantiatesUri("");
  const uri = carePlan.instantiatesUri?.find((u) => u.startsWith(prefix)) ?? "";
  return {
    id: carePlan.id ?? "",
    applyId: carePlan.identifier?.find((i) => i.system === PATHWAY_APPLY_ID_SYSTEM)?.value ?? "",
    title: carePlan.title ?? "",
    status: carePlan.status,
    pathwayCode: uri.slice(prefix.length),
    encounterId: carePlan.encounter?.reference?.split("/").pop() ?? "",
    periodStart: carePlan.period?.start ?? "",
    periodEnd: carePlan.period?.end ?? "",
  };
}

/**
 * 患者に適用したクリニカルパス(木の根だけ)。子孫は partOf に根を持つので
 * `part-of:missing=true` で根だけが引ける。開始日の新しい順。
 */
export function usePathwayApplications(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("category", `${PATHWAY_MARKER_SYSTEM}|${PATHWAY_MARKER_CODE}`);
  params.set("part-of:missing", "true");
  params.set("_sort", "-date");
  params.set("_count", "50");

  return useQuery({
    queryKey: ["CarePlan", "search", "pathway-applications", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.CarePlan>("CarePlan", params);
      const roots =
        bundle.entry
          ?.map((e) => e.resource)
          .filter((r): r is fhir4.CarePlan => r?.resourceType === "CarePlan") ?? [];
      return { roots, applications: roots.map(summarizePathwayApplication) };
    },
    enabled: Boolean(patientId),
  });
}

/**
 * パス適用の Goal(終了・中止)。適用の識別子と同じ値を apply-goal-id で持つので、
 * identifier の 1 回の検索で引ける(木の検索には根が入らないため別に引く)。
 */
export function usePathwayApplyGoal(applyId: string | undefined) {
  const params = new URLSearchParams();
  if (applyId) params.set("identifier", `${PATHWAY_APPLY_GOAL_ID_SYSTEM}|${applyId}`);

  return useQuery({
    queryKey: ["Goal", "search", "pathway-apply", applyId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Goal>("Goal", params);
      return (
        bundle.entry?.map((e) => e.resource).find((r): r is fhir4.Goal => r?.resourceType === "Goal") ?? null
      );
    },
    enabled: Boolean(applyId),
  });
}

/** パスの終了・中止(適用の CarePlan と Goal)。 */
export function useClosePathway() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      invalidatePathway(queryClient);
      queryClient.invalidateQueries({ queryKey: ["Goal"] });
    },
  });
}

/** 1 回の子孫の検索で引く病日の数(1 病日あたり子孫が数十件あるので、_count に収まるように分ける)。 */
const PATHWAY_WARD_EVENT_CHUNK = 10;

/**
 * 病棟の指示簿の「パスのタスク」(docs/clinical-pathway-design.md §6)。基準日の病日に置かれた、
 * オーダーを持たないタスクを患者ぶんまとめて引く。
 *
 * 1. `CarePlan?category=病日&date=基準日&subject=患者(カンマ OR)&_include=CarePlan:part-of` で
 *    その日の病日と、partOf の先頭(適用の根)を 1 回で引く。
 * 2. 病日の id を `part-of`(カンマ OR)に渡し、子孫(OAT ユニット・観察項目)とタスクの Procedure
 *    (`_revinclude=Procedure:based-on`)を引く。子孫は partOf に祖先すべてを持つので病日から直接引ける。
 */
export function usePathwayWardTasks(date: string, patientIds: string[]) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    // 実施の記録(invalidatePathway)で読み直されるよう CarePlan 配下のキーにする。
    queryKey: ["CarePlan", "search", "pathway-ward-tasks", date, ids.join(",")],
    queryFn: async (): Promise<PathwayWardTask[]> => {
      const eventParams = new URLSearchParams();
      eventParams.set("category", `${PATHWAY_LEVEL_SYSTEM}|event`);
      eventParams.set("date", date);
      eventParams.set("subject", ids.map((id) => `Patient/${id}`).join(","));
      eventParams.set("_include", "CarePlan:part-of");
      eventParams.set("_count", "500");
      const { data: eventBundle } = await searchResource<fhir4.Resource>("CarePlan", eventParams);
      const heads = (eventBundle.entry ?? [])
        .map((e) => e.resource)
        .filter((r): r is fhir4.CarePlan => r?.resourceType === "CarePlan");
      const events = heads.filter((cp) =>
        cp.category?.some((c) => c.coding?.some((x) => x.system === PATHWAY_LEVEL_SYSTEM && x.code === "event")),
      );
      if (events.length === 0) return [];

      const chunks: fhir4.CarePlan[][] = [];
      for (let i = 0; i < events.length; i += PATHWAY_WARD_EVENT_CHUNK) {
        chunks.push(events.slice(i, i + PATHWAY_WARD_EVENT_CHUNK));
      }
      const bundles = await Promise.all(
        chunks.map((chunk) => {
          const params = new URLSearchParams();
          params.set("part-of", chunk.map((event) => `CarePlan/${event.id}`).join(","));
          params.append("_revinclude", "Procedure:based-on");
          params.set("_count", "500");
          return searchResource<fhir4.Resource>("CarePlan", params);
        }),
      );
      const resources: fhir4.Resource[] = [...heads];
      for (const { data: bundle } of bundles) {
        for (const entry of bundle.entry ?? []) if (entry.resource) resources.push(entry.resource);
      }
      return parsePathwayWardTasks(resources);
    },
    enabled: Boolean(date) && ids.length > 0,
    placeholderData: keepPreviousData,
  });
}

/**
 * 患者ごとの進行中のパス(病棟の一覧の「パス」列。docs/clinical-pathway-design.md §6)。
 * `CarePlan?subject=患者(カンマ OR)&category=パスの印&part-of:missing=true&status=active` の 1 回で適用の根だけを引く。
 */
export function useActivePathwaysByPatient(patientIds: string[]) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    // 終了・中止・取り消し(invalidatePathway)で読み直されるよう CarePlan 配下のキーにする。
    queryKey: ["CarePlan", "search", "pathway-active-by-patient", ids.join(",")],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("subject", ids.map((id) => `Patient/${id}`).join(","));
      params.set("category", `${PATHWAY_MARKER_SYSTEM}|${PATHWAY_MARKER_CODE}`);
      params.set("part-of:missing", "true");
      params.set("status", "active");
      params.set("_sort", "date");
      params.set("_count", "500");
      const { data: bundle } = await searchResource<fhir4.CarePlan>("CarePlan", params);
      const byPatientId = new Map<string, PathwayApplicationSummary[]>();
      for (const root of resourcesOfType<fhir4.CarePlan>(bundle, "CarePlan")) {
        const patientId = root.subject?.reference?.split("/").pop() ?? "";
        byPatientId.set(patientId, [...(byPatientId.get(patientId) ?? []), summarizePathwayApplication(root)]);
      }
      return byPatientId;
    },
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });
}

/**
 * 日程の変更(docs/clinical-pathway-design.md §7.8)。病日・タスクと、自動でずらす看護指示・食事を
 * 1 transaction で PUT する。オーダーを書き換えるので、オーダーの来歴(代行なら承認待ちの通知も)を付ける。
 */
export function useShiftPathwaySchedule() {
  const queryClient = useQueryClient();
  const withOrderProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withOrderProvenance(bundle)),
    onSuccess: () => {
      invalidatePathway(queryClient);
      invalidateProvenance(queryClient);
      invalidateNursing(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

// 1 回の検索に載せるオーダー数(URL の長さの目安)。
const ORDER_TASK_CHUNK = 50;

/**
 * オーダーを指す Task。部門の受付・指示受けは focus で、承認は basedOn でオーダーを指すので、
 * 両方で引いて重複を除く。パスの取り消しで受け付け済みのオーダーを見分け、実施入力で
 * 受付の Task を探すのに使う。
 */
export function useOrderTasks(orderIds: string[]) {
  const ids = [...new Set(orderIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["Task", "search", "order", ids.join(",")],
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += ORDER_TASK_CHUNK) chunks.push(ids.slice(i, i + ORDER_TASK_CHUNK));
      const bundles = await Promise.all(
        chunks.flatMap((chunk) =>
          ["focus", "based-on"].map((param) => {
            const params = new URLSearchParams();
            params.set(param, chunk.map((id) => `ServiceRequest/${id}`).join(","));
            params.set("_count", "500");
            return searchResource<fhir4.Task>("Task", params);
          }),
        ),
      );
      const tasksById = new Map<string, fhir4.Task>();
      for (const { data: bundle } of bundles) {
        for (const task of resourcesOfType<fhir4.Task>(bundle, "Task")) {
          if (task.id) tasksById.set(task.id, task);
        }
      }
      return [...tasksById.values()];
    },
    enabled: ids.length > 0,
  });
}

/** 看護指示と指示受けの Task を消す(パスの取り消し用。普段の看護指示は中止で残す)。 */
function deleteNursingOrderRequest(order: fhir4.ServiceRequest, tasks: fhir4.Task[]) {
  const reference = `ServiceRequest/${order.id}`;
  const taskIds = tasks
    .filter((t) => t.focus?.reference === reference || t.basedOn?.some((b) => b.reference === reference))
    .map((t) => t.id)
    .filter((id): id is string => Boolean(id));
  return postBundle({
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...taskIds.map((id) => ({ request: { method: "DELETE" as const, url: `Task/${id}` } })),
      { request: { method: "DELETE", url: reference } },
    ],
  });
}

/** パスの取り消しで消すオーダー 1 件(種別はカルテのカードと同じ振り分け)。 */
export interface PathwayCancelOrder {
  order: fhir4.ServiceRequest;
  kind: string | null;
}

/**
 * 誤って適用したパスの取り消し(docs/clinical-pathway-design.md §7.9)。オーダーをカルテのカードの削除と
 * 同じ種別ごとの処理で 1 件ずつ消し(明細・予約・部門の Task・テンプレートの記入の後始末は各種別に任せる)、
 * 最後に計画の木を 1 transaction で消す。
 *
 * ［決定］種別ごとの削除の hook は 1 件ごとに一覧を読み直させるので、続けて呼ぶと開いている画面の読み直しが
 * 積み重なり上流の回数制限(1 分あたり)に当たる。ここでは hook の本体だけを順に呼び、読み直しは最後に 1 回にする。
 * 途中で失敗したら木は残す(もう一度開けば、残っているオーダーから続けられる)。
 */
export function useCancelPathwayApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orders,
      tasks,
      treeBundle,
      onProgress,
    }: {
      orders: PathwayCancelOrder[];
      tasks: fhir4.Task[];
      treeBundle: fhir4.Bundle;
      onProgress: (done: number) => void;
    }) => {
      for (const [index, { order, kind }] of orders.entries()) {
        const id = order.id ?? "";
        switch (kind) {
          case "prescription":
            await deletePrescriptionRequest(id);
            break;
          case "injection":
            await deleteInjectionSeriesRequest([id]);
            break;
          case "lab-order":
            await deleteLabOrderRequest(id);
            break;
          case "micro-order":
            await deleteMicroOrderRequest(id);
            break;
          case "patho-order":
            await deletePathoOrderRequest(id);
            break;
          case "rad-order":
            await deleteRadOrderRequest(id);
            break;
          case "physio-order":
            await deletePhysioOrderRequest(id);
            break;
          case "endoscopy-order":
            await deleteEndoscopyOrderRequest(id);
            break;
          case "treatment-order":
            await deleteTreatmentOrderRequest(id);
            break;
          case "surgery-order":
            await deleteSurgeryOrderRequest(id);
            break;
          case "meal-order":
            await deleteMealOrderRequest(id);
            break;
          case "transfusion-order":
            await deleteTransfusionOrderRequest(id);
            break;
          case "rehab-order":
            await deleteRehabOrderRequest(id);
            break;
          case "radiotherapy-order":
            await deleteRadiotherapyOrderRequest(id);
            break;
          case "nutrition-guidance-order":
            await deleteNutritionGuidanceOrderRequest(id);
            break;
          case "consult-order":
            await deleteConsultOrderRequest(id);
            break;
          case "nursing-order":
            await deleteNursingOrderRequest(order, tasks);
            break;
          default:
            throw new Error(`この種別のオーダーは取り消せません(${kind ?? "不明"})`);
        }
        onProgress(index + 1);
      }
      return postBundle(treeBundle);
    },
    // 失敗しても途中まで消えているので、どちらでも読み直す。
    onSettled: () => {
      invalidatePathway(queryClient);
      invalidateNursing(queryClient);
      invalidateAppointments(queryClient);
      invalidateConsult(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      queryClient.invalidateQueries({ queryKey: ["Goal"] });
      queryClient.invalidateQueries({ queryKey: ["Task"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
    },
  });
}

/**
 * 予定外の OAT ユニットの追加(適用の木に足す)。タスクにオーダーを付けたときは同じ
 * Bundle に入るので、適用と同じくオーダーの来歴(代行なら承認待ちの通知も)を付ける。
 */
export function useAddUnplannedUnit() {
  const queryClient = useQueryClient();
  const withOrderProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: ({ bundle }: { bundle: fhir4.Bundle; invalidate?: QueryKey[] }) =>
      postBundle(withOrderProvenance(bundle)),
    onSuccess: (_result, variables) => {
      invalidatePathway(queryClient);
      invalidateProvenance(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      for (const key of variables.invalidate ?? []) queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** 患者の入院予定(status=planned)。パスの適用先の候補にする(日付未定のものも含む)。 */
export function usePatientPlannedAdmissions(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("status", PLANNED_STATUS);
  params.set("class", ADMISSION_CLASS_CODE);
  params.set("_count", "10");

  return useQuery({
    queryKey: ["Encounter", "patient-planned-admissions", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Encounter>("Encounter", params);
      return sortPlannedAdmissions(
        bundle.entry
          ?.map((e) => e.resource)
          .filter((r): r is fhir4.Encounter => r?.resourceType === "Encounter") ?? [],
      );
    },
    enabled: Boolean(patientId),
  });
}

/**
 * パスを適用する(CarePlan の木と未実施のタスクを 1 transaction で登録)。来歴は適用の
 * CarePlan(木の根)を対象に 1 件。指示医師はオーダーのヘッダが無いので呼ぶ側が渡す。
 */
export function useApplyPathway() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  // 雛形から出したオーダーが同じ Bundle に入るので、オーダーの来歴(代行なら承認待ちの通知も)
  // を先に付ける。パスの来歴はその後ろ。
  const withOrderProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: ({
      bundle,
      applyFullUrl,
      requesterId,
    }: {
      bundle: fhir4.Bundle;
      applyFullUrl: string;
      requesterId: string;
      /** 雛形から出したオーダーの種別が読み直すキー。 */
      invalidate?: QueryKey[];
    }) => {
      const withOrders = withOrderProvenance(bundle);
      const provenance =
        enterer && requesterId
          ? buildPathwayApplyProvenanceEntry(applyFullUrl, { reference: `Practitioner/${requesterId}` }, enterer)
          : null;
      const withProvenance = provenance
        ? { ...withOrders, entry: [...(withOrders.entry ?? []), provenance] }
        : withOrders;
      return postBundle(withProvenance);
    },
    onSuccess: (_result, variables) => {
      invalidatePathway(queryClient);
      invalidateProvenance(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      for (const key of variables.invalidate ?? []) queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * 適用 1 件の木(病日・OAT ユニット・観察項目)と、そのタスク(Procedure)、タスクが指す
 * オーダーのヘッダ(ServiceRequest)を 1 回の検索で読む。子孫は partOf に根を持つので
 * `part-of=根` で全部引け、タスクは _revinclude、オーダーは :iterate でその先を辿る。
 */
export interface PathwayApplicationTree {
  application: PathwayApplicationRecord | null;
  /** タスクが指すオーダーのヘッダ(id → ServiceRequest)。 */
  orders: Map<string, fhir4.ServiceRequest>;
  /** OAT ユニットの Goal(id → Goal)。 */
  goals: Map<string, fhir4.Goal>;
  /** 木の CarePlan(id → CarePlan)。評価の保存で OAT ユニットに goal を足すときに使う。 */
  carePlans: Map<string, fhir4.CarePlan>;
  /** タスクの Procedure(id → Procedure)。実施の記録で status を書き換える。 */
  procedures: Map<string, fhir4.Procedure>;
  /** オーダーのヘッダの id → 進み具合(進捗の Task から。カルテのカードと同じ判定)。 */
  orderProgress: Map<string, OrderProgress>;
}

/** 適用の木の検索のキーの先頭。オーダーの実施入力などを閉じたときに読み直させるのに使う。 */
export const PATHWAY_TREE_KEY_PREFIX: string[] = ["CarePlan", "search", "pathway-tree"];

/** 適用の木の検索の 1 ページ(上流の _count の上限)。 */
const PATHWAY_TREE_PAGE = 500;

export function usePathwayApplicationTree(applyId: string | undefined) {
  const params = new URLSearchParams();
  if (applyId) params.set("part-of", `CarePlan/${applyId}`);
  params.append("_revinclude", "Procedure:based-on");
  params.append("_include:iterate", "Procedure:based-on");
  // OAT ユニットの Goal(評価)と観察項目の Goal(適正値)も同じ応答で揃える。
  params.append("_include", "CarePlan:goal");
  // オーダーの進み具合は ServiceRequest ではなく focus で指す進捗の Task にあるので、それも辿る。
  // リハビリ・栄養指導は日ごとの実施記録(オーダーを basedOn で指す Procedure)で実施を見るので、それも辿る。
  // 上流は同じ名前の _revinclude:iterate を並べると最後の 1 つしか効かないので、カンマで 1 つにまとめる。
  params.append("_revinclude:iterate", "Task:focus,Procedure:based-on");
  params.set("_count", String(PATHWAY_TREE_PAGE));

  return useQuery({
    queryKey: PATHWAY_TREE_KEY_PREFIX.concat(applyId ?? ""),
    queryFn: async (): Promise<PathwayApplicationTree> => {
      const [{ data: apply }, { data: bundle }] = await Promise.all([
        readResource<fhir4.CarePlan>("CarePlan", applyId as string),
        searchResource<fhir4.Resource>("CarePlan", params),
      ]);
      // フェーズを重ねた長いパスは木の CarePlan が 1 ページ(500 件)を超えるので、残りのページも読む。
      const pageCount = Math.ceil((bundle.total ?? 0) / PATHWAY_TREE_PAGE);
      const rest = await Promise.all(
        Array.from({ length: Math.max(pageCount - 1, 0) }, (_, i) => {
          const pageParams = new URLSearchParams(params);
          pageParams.set("_offset", String((i + 1) * PATHWAY_TREE_PAGE));
          return searchResource<fhir4.Resource>("CarePlan", pageParams).then((r) => r.data);
        }),
      );
      const resources = [bundle, ...rest]
        .flatMap((page) => page.entry ?? [])
        .map((e) => e.resource)
        .filter((r): r is fhir4.Resource => Boolean(r));
      const orders = new Map<string, fhir4.ServiceRequest>();
      const goals = new Map<string, fhir4.Goal>();
      const carePlans = new Map<string, fhir4.CarePlan>();
      const procedures = new Map<string, fhir4.Procedure>();
      const tasks: fhir4.Task[] = [];
      // オーダーの実施記録。パスのタスク(CarePlan を basedOn で指す Procedure)とは分けて持つ。
      const performs: fhir4.Procedure[] = [];
      for (const r of resources) {
        if (!r.id) continue;
        if (r.resourceType === "Task") tasks.push(r as fhir4.Task);
        if (r.resourceType === "ServiceRequest") orders.set(r.id, r as fhir4.ServiceRequest);
        if (r.resourceType === "Goal") goals.set(r.id, r as fhir4.Goal);
        if (r.resourceType === "CarePlan") carePlans.set(r.id, r as fhir4.CarePlan);
        if (r.resourceType === "Procedure") {
          const procedure = r as fhir4.Procedure;
          if (procedure.basedOn?.some((ref) => ref.reference?.startsWith("CarePlan/"))) procedures.set(r.id, procedure);
          else performs.push(procedure);
        }
      }
      if (apply.id) carePlans.set(apply.id, apply);
      const tree = [...carePlans.values(), ...procedures.values()].filter((r) => r.id !== apply.id);
      return {
        application: parsePathwayApplication([apply, ...tree], goals),
        orders,
        goals,
        carePlans,
        procedures,
        orderProgress: orderProgressByOrderId(orders.values(), tasks, performs),
      };
    },
    enabled: Boolean(applyId),
  });
}

/**
 * 患者のパスの評価と観察項目の実績(Observation)。category の先頭がパスの印なので
 * 患者 + category の 1 回で全部引ける(上流は category の先頭しか索引しない)。
 */
export function usePathwayObservations(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("category", `${PATHWAY_MARKER_SYSTEM}|${PATHWAY_MARKER_CODE}`);
  params.set("_count", "500");

  return useQuery({
    queryKey: ["Observation", "search", "pathway", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Observation>("Observation", params);
      return (
        bundle.entry
          ?.map((e) => e.resource)
          .filter((r): r is fhir4.Observation => r?.resourceType === "Observation") ?? []
      );
    },
    enabled: Boolean(patientId),
  });
}

/** 1 病日 × 1 OAT ユニットの評価(Goal・Observation・タスクの実施)を 1 transaction で書く。 */
export function useRecordPathwayEvaluation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      invalidatePathway(queryClient);
      queryClient.invalidateQueries({ queryKey: ["Observation", "search", "pathway"] });
      queryClient.invalidateQueries({ queryKey: ["Goal"] });
      // バリアンスの通知を作る・取り下げることがあるので、通知の一覧・件数も読み直させる。
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

/**
 * 患者のパスのバリアンスの通知(対応済み・取り下げも含む)。評価を記録するときに、同じアウトカムの
 * 通知を出し直すか・取り下げるかを決めるのに使う(docs/clinical-pathway-design.md §7.10)。
 * OAT ユニットとの突き合わせは basedOn で画面側が行う。
 */
export function usePathwayVarianceTasks(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("code", `${TASK_CODE_SYSTEM}|${PATHWAY_VARIANCE_TASK_CODE.code}`);
  params.set("_count", "500");
  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "pathway-variance", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Task>("Task", params);
      return resourcesOfType<fhir4.Task>(bundle, "Task");
    },
    enabled: Boolean(patientId),
  });
}
