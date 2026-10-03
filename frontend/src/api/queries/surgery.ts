import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_TYPE_SYSTEM } from "../../fhir/prescriptionHelpers";
import {
  buildSurgeryMoveBundle,
  buildSurgeryOrderDeleteBundle,
  buildSurgeryScheduleBundle,
  buildSurgeryScheduleServiceRequest,
  isSurgeryServiceRequest,
  summarizeSurgeryOrder,
  SURGERY_ORDER_TYPE,
  surgeryOrderItemRequests,
  surgeryOrderResponseIds,
  type SurgeryScheduleValues,
} from "../../fhir/surgeryOrderHelpers";
import {
  buildSurgeryTaskUpdate,
  surgeryTasksByOrderId,
  surgeryTaskStatus,
  type SurgeryTaskStatus,
} from "../../fhir/surgeryTaskHelpers";
import { buildSurgeryPerformDeleteEntries } from "../../fhir/surgeryResultHelpers";
import { postBundle, searchResource } from "../fhirClient";
import { makeOrderDetailHook, ORDER_ITEM_REVINCLUDES, WORKLIST_PAGE } from "./core";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";
import {
  cancelsPerform,
  deleteOrderWithItems,
  fetchWorklistBundles,
  makePerformDetailHook,
  makeUpdateTaskStatusHook,
  performCancelEntries,
  taskBundleEntry,
  worklistParams,
} from "./worklist";

// ---- 手術オーダー ----
//
// 処置と同じくヘッダと明細(術式)が別リソースなので 1 リクエストにまとめて取る。
// 第 1 段階(申込〜日程確保)では実施記録・予約を持たないため、削除で片付ける対象は
// ヘッダと明細だけ、進捗の変更も Task 1 件の書き込みだけになる。

export const useSurgeryOrderDetail = makeOrderDetailHook("surgery-order", ORDER_ITEM_REVINCLUDES);

/** 手術一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface SurgeryWorklistRow {
  order: fhir4.ServiceRequest;
  /** 術式(明細)。並び順のとおりで、先頭が主術式。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。手術部がまだ触っていないオーダーには無い(= 申込済)。 */
  task?: fhir4.Task;
}

export interface SurgeryWorklistResult {
  rows: SurgeryWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchSurgeryWorklist(date: string): Promise<SurgeryWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      // 予定手術日(occurrencePeriod)で絞る。日程未定の申込は一覧の対象外
      // (申込済のまま日程が決まっていないオーダーはカルテ側から辿る)。
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${SURGERY_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 術式も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.set("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      // 検索にヒットしたヘッダと、添えられた明細を分ける。
      if (isSurgeryServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = surgeryTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: surgeryOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  // 手術室 → 入室予定時刻の順。同じ部屋の時間の重なり(ダブルブッキング)が
  // 並びでそのまま見えるようにする(第 1 段階は枠を持たず目視で確かめるため)。
  rows.sort((a, b) => surgeryWorklistSortKey(a).localeCompare(surgeryWorklistSortKey(b)));

  return { rows, truncated };
}

function surgeryWorklistSortKey(row: SurgeryWorklistRow): string {
  const summary = summarizeSurgeryOrder(row.order);
  return `${summary.roomName || "〜"}|${summary.scheduledTime || "99:99"}`;
}

/**
 * 日程未定の手術申込。予定手術日を入れずに申し込まれたもの(= 手術部が枠を割り当てる
 * のを待っている申込)を集める。日付で絞れないので `occurrence:missing` で引く。
 *
 * 希望日を書いた申込は occurrence を持つのでここには出ない(予定日別タブのその日に
 * 「申込済」として出る)。手術部の待ち行列が 2 か所に分かれるが、1 か所に集めるには
 * 希望日と確定日を別要素で持つか登録時から Task を作る必要があり、どちらも高くつく。
 */
export function useSurgeryUnscheduledList() {
  return useQuery({
    queryKey: ["ServiceRequest", "surgery-unscheduled"],
    queryFn: () => fetchSurgeryUnscheduled(),
    placeholderData: keepPreviousData,
  });
}

async function fetchSurgeryUnscheduled(): Promise<SurgeryWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = new URLSearchParams();
      params.set("category", `${ORDER_TYPE_SYSTEM}|${SURGERY_ORDER_TYPE.code}`);
      params.set("occurrence:missing", "true");
      params.set("based-on:missing", "true");
      params.set("_count", String(WORKLIST_PAGE));
      params.set("_offset", String(page * WORKLIST_PAGE));
      params.set("_include", "ServiceRequest:subject");
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.set("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (isSurgeryServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = surgeryTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: surgeryOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  // 緊急を先頭に、あとは申込日の古い順(待たせている順)。
  rows.sort((a, b) => {
    const urgency = surgeryUrgencyRank(a.order) - surgeryUrgencyRank(b.order);
    if (urgency !== 0) return urgency;
    return (a.order.authoredOn ?? "").localeCompare(b.order.authoredOn ?? "");
  });

  return { rows, truncated };
}

/** 緊急 → 準緊急 → 予定 の順に小さい値を返す。 */
function surgeryUrgencyRank(order: fhir4.ServiceRequest): number {
  if (order.priority === "stat") return 0;
  if (order.priority === "urgent") return 1;
  return 2;
}

/** 手術オーダーの術式明細。日程を動かすときに、明細の予定日時も揃えるために引く。 */
async function fetchSurgeryItems(order: fhir4.ServiceRequest): Promise<fhir4.ServiceRequest[]> {
  if (!order.id) return [];
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${order.id}`);
  params.set("_count", "200");
  const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
  return surgeryOrderItemRequests(
    (bundle.entry ?? [])
      .map((entry) => entry.resource)
      .filter((r): r is fhir4.ServiceRequest => r?.resourceType === "ServiceRequest"),
    order.id,
  );
}

/**
 * 日程の確定。オーダーの日程と Task(受付済 = 日程確定)を 1 transaction で書く。
 * 片方だけ通ると「日程は入ったが未受付」「受付済だが日程未定」になってしまう。
 */
export function useConfirmSurgerySchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      order,
      task,
      values,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      values: SurgeryScheduleValues;
    }) => {
      const scheduled = buildSurgeryScheduleServiceRequest(order, values);
      const items = await fetchSurgeryItems(order);
      return postBundle(
        buildSurgeryScheduleBundle(
          order,
          values,
          // Task には確定後のオーダー(priority・requester)を渡す。
          taskBundleEntry(buildSurgeryTaskUpdate(task, scheduled, "accepted")),
          items,
        ),
      );
    },
    onSuccess: () => {
      // 予定日が入ると予定日別タブにも移るので、手術関連はまとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

/**
 * 手術室カレンダーのドラッグ＆ドロップによる日程の移動。
 *
 * 動かすのは予定日時と手術室だけで、進捗(Task)は触らない
 * (buildSurgeryMoveBundle 参照)。所要時間は呼び出し側が今の値をそのまま渡す。
 */
export function useMoveSurgerySchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      order,
      values,
    }: {
      order: fhir4.ServiceRequest;
      values: SurgeryScheduleValues;
    }) => postBundle(buildSurgeryMoveBundle(order, values, await fetchSurgeryItems(order))),
    onSuccess: () => {
      // 日付をまたぐ移動があるので、日別のキャッシュをまとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

/**
 * 日程未定のまま入室する(緊急手術)。押した日時をそのまま予定日時にして、
 * Task を入室中にするところまでを 1 transaction で書く。
 *
 * 緊急手術は日程を決めてから始めるものではないので、「日程を確定 → 入室」の
 * 2 操作を踏ませると現場が先に手術を始めて記録が後追いになる。入室した事実の方が
 * 確かなので、それを予定日時として記録し、以後は予定日別タブの当日ぶんに並べる。
 */
export function useAdmitUnscheduledSurgery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      order,
      task,
      now,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      /** 入室日時。datetime-local の入力形式(YYYY-MM-DDTHH:mm)。 */
      now: string;
    }) => {
      const summary = summarizeSurgeryOrder(order);
      // 日程だけを埋める。所要時間・手術室は申込で希望していればそのまま残す。
      const values: SurgeryScheduleValues = {
        scheduledDate: now.slice(0, 10),
        scheduledTime: now.slice(11, 16),
        durationMinutes: summary.durationMinutes != null ? String(summary.durationMinutes) : "",
        roomId: summary.roomId,
        roomName: summary.roomName,
      };
      const scheduled = buildSurgeryScheduleServiceRequest(order, values);
      const items = await fetchSurgeryItems(order);
      return postBundle(
        buildSurgeryScheduleBundle(
          order,
          values,
          taskBundleEntry(buildSurgeryTaskUpdate(task, scheduled, "in-progress")),
          items,
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

/**
 * 予定手術日 1 日ぶんの手術オーダーの取得条件。
 *
 * 登録の直前にキャッシュを介さず引き直したい場面(ダブルブッキングの確認。
 * useSurgeryConflictCheck)があるので、キーと取得関数を 1 か所にまとめて
 * queryClient.fetchQuery からも同じものを使えるようにしてある。
 */
export function surgeryWorklistQuery(date: string) {
  return {
    queryKey: ["ServiceRequest", "surgery-worklist", date] as const,
    queryFn: () => fetchSurgeryWorklist(date),
  };
}

/** 予定手術日 1 日ぶんの手術オーダー。日付が未選択の間は読みに行かない。 */
export function useSurgeryWorklist(date: string) {
  return useQuery({
    ...surgeryWorklistQuery(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/**
 * 手術室カレンダーの週表示が読む 7 日ぶん。
 *
 * 日別のクエリを 7 本並べるだけなので、キャッシュは一覧・日表示とそのまま共有
 * される(週を見てから日へ降りるときに読み直しが起きない)。
 */
export function useSurgeryWorklistWeek(dates: string[]) {
  return useQueries({
    queries: dates.map((date) => ({
      ...surgeryWorklistQuery(date),
      enabled: Boolean(date),
      placeholderData: keepPreviousData,
    })),
  });
}

export const useSurgeryPerformDetail = makePerformDetailHook("surgery-perform", { observations: true });

/**
 * 受付(日程確定)・入室・中止などの進捗を書き込む。実施済から戻す(実施取消)ときは、
 * 実施記録も同じ transaction で消す。
 */
export const useUpdateSurgeryTaskStatus = makeUpdateTaskStatusHook<SurgeryTaskStatus>(
  buildSurgeryTaskUpdate,
  "surgery-worklist",
  {
    cancelPerform: {
      cancels: cancelsPerform(surgeryTaskStatus),
      entries: (order) =>
        performCancelEntries(order.id ?? "", { observations: true }, buildSurgeryPerformDeleteEntries),
    },
    invalidate: invalidateSurgery,
  },
);

/**
 * 手術の実施登録。実施記録一式と Task の実施済を 1 つの transaction で書き込む。
 * Bundle の組み立ては surgeryResultHelpers を参照。
 */
export function useRegisterSurgeryPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      invalidateSurgery(queryClient);
    },
  });
}

/**
 * 手術の進捗・実施記録が動いたときに読み直させるもの。日程未定タブは
 * 中止・入室でも中身が変わるので必ず含める。
 */
function invalidateSurgery(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "surgery-worklist"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "surgery-unscheduled"] });
  // カルテのオーダーカードも進捗と実施情報を出しているので読み直させる。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  // 取消では実施記録も消しているので、FHIR JSON 表示の実施記録も引き直させる。
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
}

/** 手術オーダーの更新。ヘッダ + 明細の transaction を書くだけ(予約の付け替えは無い)。 */
export function useUpdateSurgeryOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      // 予定日時が動くと手術一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 術前指示をテンプレートから書いていれば、その回答も一緒に消す(孤児を残さない)。
 * useDeleteSurgeryOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteSurgeryOrderRequest = (srId: string) =>
  deleteOrderWithItems(srId, {
    itemsOf: surgeryOrderItemRequests,
    build: ({ srId, itemIds, requests }) =>
      buildSurgeryOrderDeleteBundle(srId, itemIds, surgeryOrderResponseIds(requests)),
  });

export function useDeleteSurgeryOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSurgeryOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}
