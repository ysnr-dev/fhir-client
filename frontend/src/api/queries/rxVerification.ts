import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays } from "../../lib/dates";
import { INJECTION_SERIES_SYSTEM, injectionDayOf } from "../../fhir/injectionHelpers";
import {
  buildVerifiedRxTask,
  DEFAULT_RX_VERIFICATION,
  isRxVerificationTarget,
  isRxVerificationTask,
  refocusRxVerificationTask,
  RX_VERIFICATION_TASK_CODE,
  rxVerificationEntries,
  rxVerificationGroupIdentifier,
  rxVerificationGroupOf,
  rxVerificationLookupOf,
  rxVerificationOrderId,
  rxVerificationOrdersInBundle,
  rxVerificationTasksByGroup,
  type RxVerificationResult,
} from "../../fhir/rxVerificationHelpers";
import { transactionBundle, versionEtag } from "../../fhir/shared";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { postBundle } from "../fhirClient";
import { resourcesOfType, searchAllPages, WORKLIST_PAGE } from "./core";
import { useFacilitySettings } from "./organization";

// 処方監査(docs/rx-verification-design.md)の読み書き。Task の組み立ては fhir/rxVerificationHelpers.ts。

const CODE_PARAM = `${TASK_CODE_SYSTEM}|${RX_VERIFICATION_TASK_CODE.code}`;
/** focus・group-identifier を OR で並べる塊の大きさ(URL の長さを抑える)。 */
const CHUNK = 20;
const QUEUE_MAX_PAGES = 4;

export const RX_VERIFICATION_KEY = ["Task", "rx-verification"];

export function useRxVerificationSettings() {
  const settings = useFacilitySettings();
  return settings.data?.rx_verification ?? DEFAULT_RX_VERIFICATION;
}

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += CHUNK) result.push(values.slice(i, i + CHUNK));
  return result;
}

async function searchVerificationTasks(param: "focus" | "group-identifier", values: string[]): Promise<fhir4.Task[]> {
  const found: fhir4.Task[] = [];
  for (const chunk of chunks(values)) {
    const params = new URLSearchParams();
    params.set("code", CODE_PARAM);
    params.set("status", "requested,completed");
    params.set(param, chunk.join(","));
    const { matches } = await searchAllPages<fhir4.Task>("Task", params, { page: 100, maxPages: 2, complete: true });
    found.push(...matches);
  }
  return found;
}

/**
 * オーダーの登録・編集 Bundle に、監査 Task の作成・未監査への戻しを足す。院内の処方・注射が
 * 無ければ何も引かない。削除は orderDelete がオーダーを指す Task を消す(連日の注射の付け替えは
 * rxVerificationDeleteEntries)。
 */
export async function withRxVerificationTasks(bundle: fhir4.Bundle): Promise<fhir4.Bundle> {
  const orders = rxVerificationOrdersInBundle(bundle);
  if (orders.length === 0) return bundle;
  const { orderIds, groups } = rxVerificationLookupOf(orders);
  const [byFocus, byGroup] = await Promise.all([
    searchVerificationTasks(
      "focus",
      orderIds.map((id) => `ServiceRequest/${id}`),
    ),
    searchVerificationTasks(
      "group-identifier",
      groups.map((group) => `${INJECTION_SERIES_SYSTEM}|${group}`),
    ),
  ]);
  const entries = rxVerificationEntries(orders, [...byFocus, ...byGroup]);
  return entries.length === 0 ? bundle : { ...bundle, entry: [...(bundle.entry ?? []), ...entries] };
}

/**
 * オーダーの削除で消える Task のうち、連日の注射の監査 Task で束ねに残る日があるものは、消さずに
 * 残りの最初の日へ付け替える。返すのは付け替えの PUT と、付け替えたので消さない Task の id。
 */
export async function rxVerificationDeleteEntries(
  tasks: fhir4.Task[],
  deletedOrderIds: string[],
): Promise<{ entries: fhir4.BundleEntry[]; keptTaskIds: Set<string> }> {
  const entries: fhir4.BundleEntry[] = [];
  const keptTaskIds = new Set<string>();
  const deleted = new Set(deletedOrderIds);
  for (const task of tasks) {
    const group = isRxVerificationTask(task) ? rxVerificationGroupIdentifier(task) : undefined;
    if (!task.id || !group) continue;
    const params = new URLSearchParams();
    params.set("requisition", `${INJECTION_SERIES_SYSTEM}|${group}`);
    params.set("_elements", "id,occurrenceDateTime,authoredOn");
    const { matches } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
      page: WORKLIST_PAGE,
      maxPages: 1,
      complete: true,
    });
    const remaining = matches
      .filter((sr) => sr.id && !deleted.has(sr.id))
      .sort((a, b) => injectionDayOf(a).localeCompare(injectionDayOf(b)));
    if (remaining.length === 0) continue;
    entries.push({
      resource: refocusRxVerificationTask(task, remaining[0].id as string),
      request: { method: "PUT", url: `Task/${task.id}`, ...(versionEtag(task) ? { ifMatch: versionEtag(task) } : {}) },
    });
    keptTaskIds.add(task.id);
  }
  return { entries, keptTaskIds };
}

/** 束ねの uuid → 監査 Task(注射一覧の、束ねの 2 日目以降の行に写す)。 */
export async function fetchRxVerificationByGroups(groups: string[]): Promise<Map<string, fhir4.Task>> {
  const values = [...new Set(groups.filter(Boolean))].map((group) => `${INJECTION_SERIES_SYSTEM}|${group}`);
  if (values.length === 0) return new Map();
  return rxVerificationTasksByGroup(await searchVerificationTasks("group-identifier", values));
}

/**
 * オーダーの監査 Task(カルテの詳細に出す)。連日の注射は束ねで引く(2 日目以降の日は focus で引けない)。
 * 対象外のオーダーでは引かない。
 */
export function useOrderRxVerification(order: fhir4.ServiceRequest | undefined) {
  const target = order && isRxVerificationTarget(order) ? order : undefined;
  const group = target ? rxVerificationGroupOf(target) : undefined;
  return useQuery({
    queryKey: [...RX_VERIFICATION_KEY, "order", target?.id, group ?? null],
    queryFn: async () => {
      if (group) return (await fetchRxVerificationByGroups([group])).get(group) ?? null;
      const tasks = await searchVerificationTasks("focus", [`ServiceRequest/${target?.id}`]);
      return tasks[0] ?? null;
    },
    enabled: Boolean(target?.id),
  });
}

export interface RxVerificationQueue {
  tasks: fhir4.Task[];
  patients: Map<string, fhir4.Patient>;
  /** 起点のオーダー(ServiceRequest の id → オーダー)。 */
  orders: Map<string, fhir4.ServiceRequest>;
  /** 起点のオーダーを焦点にする Task(進捗・疑義照会)。オーダーの id → Task。 */
  orderTasks: Map<string, fhir4.Task[]>;
  truncated: boolean;
}

async function fetchOrderTasks(orderIds: string[]): Promise<Map<string, fhir4.Task[]>> {
  const byOrder = new Map<string, fhir4.Task[]>();
  for (const chunk of chunks(orderIds)) {
    const params = new URLSearchParams();
    params.set("focus", chunk.map((id) => `ServiceRequest/${id}`).join(","));
    const { matches } = await searchAllPages<fhir4.Task>("Task", params, { page: 200, maxPages: 2 });
    for (const task of matches) {
      if (isRxVerificationTask(task)) continue;
      const id = rxVerificationOrderId(task);
      if (id) byOrder.set(id, [...(byOrder.get(id) ?? []), task]);
    }
  }
  return byOrder;
}

/**
 * 監査 Task の一覧。未監査は日付を問わず全件、監査済は監査日の期間で引く。
 * 起点のオーダー(_include=Task:focus)と患者(_include=Task:subject)を同じ応答で受け取り、
 * 進捗・疑義照会の Task はオーダーの id で引き直す。
 */
async function fetchRxVerificationQueue(
  mode: "pending" | "verified",
  range: { from: string; to: string },
): Promise<RxVerificationQueue> {
  const params = new URLSearchParams();
  params.set("code", CODE_PARAM);
  if (mode === "pending") {
    params.set("status", "requested");
    params.set("_sort", "authored-on");
  } else {
    params.set("status", "completed");
    // 監査日は lastModified(監査済にした時刻)で引く。executionPeriod は未監査の間も含むので重なりで拾いすぎる。
    params.append("modified", `ge${range.from}`);
    params.append("modified", `lt${addDays(range.to, 1)}`);
    params.set("_sort", "-modified");
  }
  params.append("_include", "Task:subject");
  params.append("_include", "Task:focus");
  const { matches, bundles, truncated } = await searchAllPages<fhir4.Task>("Task", params, {
    page: WORKLIST_PAGE,
    maxPages: QUEUE_MAX_PAGES,
  });
  const patients = new Map<string, fhir4.Patient>();
  const orders = new Map<string, fhir4.ServiceRequest>();
  for (const bundle of bundles) {
    for (const patient of resourcesOfType<fhir4.Patient>(bundle, "Patient")) {
      if (patient.id) patients.set(patient.id, patient);
    }
    for (const order of resourcesOfType<fhir4.ServiceRequest>(bundle, "ServiceRequest")) {
      if (order.id) orders.set(order.id, order);
    }
  }
  const orderTasks = mode === "pending" ? await fetchOrderTasks([...orders.keys()]) : new Map();
  return { tasks: matches, patients, orders, orderTasks, truncated };
}

export function useRxVerificationQueue(mode: "pending" | "verified", range: { from: string; to: string }) {
  return useQuery({
    queryKey: [...RX_VERIFICATION_KEY, mode, mode === "verified" ? range : null],
    queryFn: () => fetchRxVerificationQueue(mode, range),
  });
}

/** 監査済にする(監査済のものを開き直したときは結果の上書き)。 */
export function useCompleteRxVerification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      task,
      actor,
      result,
    }: {
      task: fhir4.Task;
      actor: { practitionerId: string; display: string };
      result: RxVerificationResult;
    }) => {
      const verified = buildVerifiedRxTask(task, actor, result);
      const ifMatch = versionEtag(task);
      return postBundle(
        transactionBundle([
          { resource: verified, request: { method: "PUT", url: `Task/${task.id}`, ...(ifMatch ? { ifMatch } : {}) } },
        ]),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Task"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rx-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "injection-worklist"] });
    },
  });
}
