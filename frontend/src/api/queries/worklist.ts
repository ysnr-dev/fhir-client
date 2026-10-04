import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { splitPerformBundle } from "../../fhir/radResultHelpers";
import { isActiveAppointment } from "../../fhir/appointmentHelpers";
import { postBundle, searchResource } from "../fhirClient";
import { buildCancelEntriesOf } from "./appointment";
import { hasNextPage, resourcesOfType, WORKLIST_PAGE } from "./core";

// 1 日のオーダーがこの件数を超えることは想定していない。超えた場合は読むのをやめ、
// 画面に「一部のみ」と出す(黙って切り捨てると全件見えているように見えるため)。
const WORKLIST_MAX_PAGES = 2;

/**
 * ヘッダ検索の共通パラメータ。呼び出し側でドメインの _revinclude を足す。
 *
 * 日付はオーダー開始日(occurrenceDateTime: 撮影日・検査日・注射日・投与予定日 …)で引く。
 * 全種別で occurrence が開始日、authoredOn が登録日時(fhir/shared.ts 冒頭)。
 * 例外は処方一覧だけで、交付日(登録日)で引く(理由は api/queries/prescription.ts の「処方一覧」の節)。
 */
export function worklistParams(
  category: string,
  date: string,
  page: number,
  dateParam: "occurrence" | "authoredon" = "occurrence",
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", category);
  // occurrenceDateTime は撮影時刻まで持つことがあるが、上流が日付をローカル
  // タイムゾーンで解釈するので、そのまま渡せば「その日の撮影」になる。
  params.set(dateParam, date);
  // 明細はオーダーそのものではないので、ヒットさせるのはヘッダだけにする。
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_include", "ServiceRequest:subject");
  return params;
}

/**
 * ページングしながら全件読む。Patient と Task はここで回収し、それ以外の
 * リソースは collect に渡す(ヘッダとして数えたら true を返す)。
 */
export async function fetchWorklistBundles(
  buildParams: (page: number) => URLSearchParams,
  collect: (resource: fhir4.Resource) => boolean,
): Promise<{ patientsById: Map<string, fhir4.Patient>; tasks: fhir4.Task[]; truncated: boolean }> {
  const patientsById = new Map<string, fhir4.Patient>();
  const tasks: fhir4.Task[] = [];
  let truncated = false;

  for (let page = 0; page < WORKLIST_MAX_PAGES; page += 1) {
    const { data: bundle } = await searchResource<fhir4.Resource>(
      "ServiceRequest",
      buildParams(page),
    );

    let matched = 0;
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (!resource) continue;
      if (resource.resourceType === "Patient") {
        if (resource.id) patientsById.set(resource.id, resource as fhir4.Patient);
      } else if (resource.resourceType === "Task") {
        tasks.push(resource as fhir4.Task);
      } else if (collect(resource)) {
        matched += 1;
      }
    }

    if (matched < WORKLIST_PAGE) break;
    if (page === WORKLIST_MAX_PAGES - 1) truncated = hasNextPage(bundle);
  }

  return { patientsById, tasks, truncated };
}

/**
 * 時刻を持たないオーダーの一覧(検体検査・処方)の並び順。患者番号順に並べて
 * 呼び出しや突き合わせで探しやすくする。患者が読めなかった行は末尾へ。
 */
export function comparePatientNumber(
  a: { patient?: fhir4.Patient },
  b: { patient?: fhir4.Patient },
): number {
  const aNumber = a.patient?.identifier?.[0]?.value ?? "";
  const bNumber = b.patient?.identifier?.[0]?.value ?? "";
  if (!aNumber || !bNumber) return aNumber ? -1 : bNumber ? 1 : 0;
  return aNumber.localeCompare(bNumber, undefined, { numeric: true });
}

/** Task の書き込み用エントリ。まだ id が無い(新規)なら POST、あれば PUT。 */
export function taskBundleEntry(resource: fhir4.Task): fhir4.BundleEntry {
  return {
    resource,
    request: resource.id
      ? { method: "PUT", url: `Task/${resource.id}` }
      : { method: "POST", url: "Task" },
  };
}

interface UpdateTaskStatusOptions<S> {
  /**
   * 実施済から戻す(取消)ときに、同じ transaction で消す実施記録のエントリ。
   * 進捗だけ戻して実施記録が残ると、取り消したはずの検査が実施済のまま会計・線量集計・
   * カルテに現れる(docs/rad-result-design.md §7-6)。消せない事情があれば throw する。
   */
  cancelPerform?: {
    cancels: (task: fhir4.Task | undefined, status: S) => boolean;
    entries: (order: fhir4.ServiceRequest) => Promise<fhir4.BundleEntry[]>;
  };
  /** 読み直しの指示。省略時は部門一覧・検索キャッシュ(取消があれば実施記録も)。 */
  invalidate?: (queryClient: QueryClient) => void;
}

/**
 * 受付などの進捗を書き込む hook を作る。Task がまだ無いオーダーでは新しく作る。
 * transaction Bundle で書き、一覧が読んだ Task の版(meta.versionId)は postBundle が
 * ifMatch に添える(ほかの人が先に進捗を変えていたら 412)。
 */
export function makeUpdateTaskStatusHook<S extends fhir4.Task["status"]>(
  buildUpdate: (
    task: fhir4.Task | undefined,
    order: fhir4.ServiceRequest,
    status: S,
  ) => fhir4.Task,
  worklistKey: string,
  options: UpdateTaskStatusOptions<S> = {},
) {
  return function useUpdateTaskStatus() {
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: async ({
        order,
        task,
        status,
      }: {
        order: fhir4.ServiceRequest;
        task: fhir4.Task | undefined;
        status: S;
      }) => {
        const taskEntry = taskBundleEntry(buildUpdate(task, order, status));
        const performEntries =
          options.cancelPerform && options.cancelPerform.cancels(task, status)
            ? await options.cancelPerform.entries(order)
            : [];
        return postBundle({
          resourceType: "Bundle",
          type: "transaction",
          entry: [...performEntries, taskEntry],
        });
      },
      onSuccess: () => {
        if (options.invalidate) {
          options.invalidate(queryClient);
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["ServiceRequest", worklistKey] });
        // カルテのオーダーカード側の表示にも効くよう、検索キャッシュも読み直させる。
        queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
        // 取消では実施記録も消しているので、FHIR JSON 表示の実施記録も引き直させる。
        if (options.cancelPerform) {
          queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
        }
      },
    });
  };
}

/**
 * 実施記録の検索条件。オーダーにぶら下がる Procedure と、その子の薬剤
 * (MedicationAdministration)・測定値(Observation。被曝線量など)を 1 リクエストで集める。
 * 測定値を作らない部門(生理検査・内視鏡・処置)は observations を付けない。
 *
 * 取消で消す対象は一覧が持っている行の情報からではなく、その場で引き直す。取消は稀な
 * 操作で、一覧を開いた後に別の端末で登録された実施記録も残さず消したいため。
 */
function performSearchParams(orderId: string, options: { observations: boolean }): URLSearchParams {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("_count", "100");
  params.append("_revinclude", "MedicationAdministration:part-of");
  if (options.observations) params.append("_revinclude", "Observation:part-of");
  return params;
}

/** 実施記録(Procedure 一式)。カルテカードの FHIR JSON 表示と読影の入力モーダルが使う。 */
export function makePerformDetailHook(kind: string, options: { observations: boolean }) {
  return function usePerformDetail(orderId: string | undefined) {
    return useQuery({
      queryKey: ["Procedure", "search", kind, orderId],
      queryFn: () =>
        searchResource<fhir4.Resource>("Procedure", performSearchParams(orderId ?? "", options)),
      enabled: Boolean(orderId),
    });
  };
}

/** 実施の取消で片付ける実施記録を引き直し、削除エントリにする。 */
export async function performCancelEntries(
  orderId: string,
  options: { observations: boolean },
  build: (
    procedures: fhir4.Procedure[],
    administrations: fhir4.MedicationAdministration[],
    observations: fhir4.Observation[],
  ) => fhir4.BundleEntry[],
): Promise<fhir4.BundleEntry[]> {
  const { data: bundle } = await searchResource<fhir4.Resource>(
    "Procedure",
    performSearchParams(orderId, options),
  );
  const performed = splitPerformBundle(bundle);
  return build(performed.procedures, performed.administrations, performed.observations);
}

/** 実施済から戻す(= 取消)か。 */
export function cancelsPerform<S extends fhir4.Task["status"]>(
  statusOf: (task: fhir4.Task | undefined) => string | undefined,
) {
  return (task: fhir4.Task | undefined, status: S) =>
    statusOf(task) === "completed" && status !== "completed";
}

interface DeleteOrderOptions {
  /** 明細(ヘッダにぶら下がる ServiceRequest)の取り出し。 */
  itemsOf: (requests: fhir4.ServiceRequest[], srId: string) => fhir4.ServiceRequest[];
  /** 削除 Bundle の組み立て。 */
  build: (context: {
    srId: string;
    itemIds: string[];
    itemRequests: fhir4.ServiceRequest[];
    requests: fhir4.ServiceRequest[];
    appointmentEntries: fhir4.BundleEntry[];
  }) => fhir4.Bundle;
  /** 予約を持つ種別。有効な予約の取消(cancelled + 枠の free 化)も同じ transaction に同梱する。 */
  withAppointment?: boolean;
  /** 消してよいかの確認。消せなければ throw する。応答には revincludes のリソースも含む。 */
  guard?: (bundle: fhir4.Bundle) => void;
  revincludes?: string[];
}

/**
 * 明細が独立した ServiceRequest のオーダーを消す。ヘッダだけ消すと明細が残るので、
 * 消す直前に明細を引き直してからまとめて消す(一覧が持つ行の情報は古いことがある)。
 */
export async function deleteOrderWithItems(srId: string, options: DeleteOrderOptions) {
  const params = new URLSearchParams();
  params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");
  if (options.withAppointment) params.append("_revinclude", "Appointment:based-on");
  for (const target of options.revincludes ?? []) params.append("_revinclude", target);
  const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
  options.guard?.(bundle);

  const requests = resourcesOfType<fhir4.ServiceRequest>(bundle, "ServiceRequest");
  const itemRequests = options.itemsOf(requests, srId);
  const itemIds = itemRequests
    .map((request) => request.id)
    .filter((id): id is string => Boolean(id));
  const appointmentEntries = options.withAppointment
    ? await buildCancelEntriesOf(
        resourcesOfType<fhir4.Appointment>(bundle, "Appointment").filter(isActiveAppointment),
      )
    : [];
  return postBundle(options.build({ srId, itemIds, itemRequests, requests, appointmentEntries }));
}
