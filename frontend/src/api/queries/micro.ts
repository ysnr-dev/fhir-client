import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { excludeNursingProblems } from "../../fhir/conditionHelpers";
import { observationIdsFromReport, specimenIdsFromReport } from "../../fhir/labResultHelpers";
import { buildMicroOrderDeleteBundle, microOrderItemRequests } from "../../fhir/microOrderHelpers";
import { buildMicroResultDeleteBundle } from "../../fhir/microResultHelpers";
import {
  createResource,
  deleteResource,
  type FhirResult,
  postBundle,
  readHistory,
  readResource,
  searchResource,
  updateResource,
} from "../fhirClient";
import {
  hasRelation,
  HISTORY_COUNT,
  NOTIFICATION_TASK_KEY,
  resourcesOfType,
  saveWithImages,
} from "./core";
import { useLabResultDetail } from "./labResult";
import { withResultReviewTask } from "./notification";
import { fetchDerivedObservationRefs } from "./patientProfile";
import { deleteOrderWithItems } from "./worklist";

// ---- 細菌検査結果 ----

// 内容表示・編集の取得は検体検査結果と同じ形(_id + result / specimen の _include)。
export function useMicroResultDetail(reportId: string | undefined) {
  return useLabResultDetail(reportId);
}

// 細菌検査結果を保存・削除するとオーダーの紐付け状況が変わるため、
// 細菌検査オーダーの候補(["ServiceRequest", "search"] 配下)も無効化する。
export function useCreateMicroResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bundle: fhir4.Bundle) =>
      postBundle(await withResultReviewTask(bundle, "micro", microReviewSummary)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

export function useUpdateMicroResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bundle: fhir4.Bundle) =>
      postBundle(await withResultReviewTask(bundle, "micro", microReviewSummary)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

/** 細菌検査の通知に出す要約。検体が何かで「どの検査の結果か」が分かる。 */
function microReviewSummary(report: fhir4.DiagnosticReport): string {
  return report.specimen?.[0]?.display ?? "";
}

/** 病理の通知に出す要約。検体(臓器・部位)を並べる。 */
export function pathoReviewSummary(report: fhir4.DiagnosticReport): string {
  const names = (report.specimen ?? [])
    .map((specimen) => specimen.display)
    .filter((name): name is string => Boolean(name));
  return names.length > 2 ? `${names.slice(0, 2).join("・")} ほか` : names.join("・");
}

export function useDeleteMicroResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: string) => {
      // 削除対象の Observation / Specimen は DiagnosticReport の参照から辿る。
      const { data: report } = await readResource<fhir4.DiagnosticReport>(
        "DiagnosticReport",
        reportId,
      );
      return postBundle(
        buildMicroResultDeleteBundle(
          reportId,
          observationIdsFromReport(report),
          specimenIdsFromReport(report),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

const CONDITION_COUNT = 20;

export function useConditionSearch(patientId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", String(CONDITION_COUNT));
  params.set("_offset", String(offset));
  // 開始日の降順(新しい順)。_sort のキーは検索パラメータ名 onset-date。
  params.set("_sort", "-onset-date");
  excludeNursingProblems(params);

  const query = useQuery({
    queryKey: ["Condition", "search", patientId, offset],
    queryFn: () => searchResource<fhir4.Condition>("Condition", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: CONDITION_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function useCondition(id: string | undefined) {
  return useQuery({
    queryKey: ["Condition", id],
    queryFn: () => readResource<fhir4.Condition>("Condition", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateCondition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (condition: fhir4.Condition) => createResource(condition),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Condition", "search"] });
    },
  });
}

export function useUpdateCondition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ condition, etag }: { condition: fhir4.Condition; etag: string }) =>
      updateResource(condition, etag),
    onSuccess: (result: FhirResult<fhir4.Condition>) => {
      queryClient.invalidateQueries({ queryKey: ["Condition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Condition", result.data.id] });
    },
  });
}

export function useDeleteCondition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Condition", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Condition", "search"] });
    },
  });
}

// プロブレムリストの上限。1 患者の病名は高々数十件の想定なので 1 回の検索で足りる。
export const KARTE_CONDITION_COUNT = 100;

// カルテ画面のプロブレムリスト用。プロブレムと保険病名の振り分けは
// splitConditions() でクライアント側が行うため、ここでは患者の病名を全件取得する
// (上流 fhir-server は未知の検索パラメータを黙って無視して全件返すことがあり、
//  category での絞り込みをサーバーに任せられない)。
// クエリキーを ["Condition", "search", ...] 配下に置くことで、病名の登録・更新・
// 削除の invalidate がそのまま効き、プロブレムリストも自動で再取得される。
// 患者の保険・公費。レセコンが正本で、カルテからは登録しないので読み取りだけ。
// 使えなくなった保険も status=cancelled として残るため、期間や履歴を見せられる。
export function useCoverages(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("beneficiary", `Patient/${patientId}`);
  params.set("_count", "50");

  const query = useQuery({
    queryKey: ["coverages", patientId],
    queryFn: () => searchResource<fhir4.Coverage>("Coverage", params),
    enabled: Boolean(patientId),
  });

  const coverages =
    resourcesOfType<fhir4.Coverage>(query.data?.data, "Coverage");

  return { ...query, coverages };
}

export function useKarteConditions(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", String(KARTE_CONDITION_COUNT));
  params.set("_sort", "-onset-date");
  excludeNursingProblems(params);

  const query = useQuery({
    queryKey: ["Condition", "search", "karte", patientId],
    queryFn: () => searchResource<fhir4.Condition>("Condition", params),
    enabled: Boolean(patientId),
  });

  const conditions =
    resourcesOfType<fhir4.Condition>(query.data?.data, "Condition");

  return { ...query, conditions };
}

/**
 * 診療記録の版履歴。「いつ誰が何を直したか」を辿るために使う。
 * クエリキーを ["Composition", id] 配下に置き、更新の invalidate が効くようにする。
 */
export function useClinicalNoteHistory(id: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ["Composition", id, "history"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("_count", String(HISTORY_COUNT));
      const { data: bundle } = await readHistory<fhir4.Composition>(
        "Composition",
        id as string,
        params,
      );
      return bundle;
    },
    enabled: Boolean(id) && enabled,
  });

  return {
    ...query,
    // 上流の _history は新しい版から返す(回帰 spec で固定済み)。
    versions: resourcesOfType<fhir4.Composition>(query.data, "Composition"),
  };
}

export function useClinicalNote(id: string | undefined) {
  return useQuery({
    queryKey: ["Composition", id],
    queryFn: () => readResource<fhir4.Composition>("Composition", id as string),
    enabled: Boolean(id),
  });
}

/**
 * Bundle エントリのうち、既存の QuestionnaireResponse を書き換える/消すものの id。
 * その回答から前回生成した Observation は作り直し(または道連れ削除)の対象になる。
 * 新規記入(urn:uuid で POST)は前回の生成物を持たないので含まない。
 */
function refreshedResponseIds(entries: fhir4.BundleEntry[]): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    const method = entry.request?.method;
    if (method !== "PUT" && method !== "DELETE") continue;
    const id = entry.request?.url?.match(/^QuestionnaireResponse\/(.+)$/)?.[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** 上記の回答から前回生成した Observation を消す DELETE エントリ。 */
export async function staleObservationEntries(entries: fhir4.BundleEntry[]): Promise<fhir4.BundleEntry[]> {
  const refs = await fetchDerivedObservationRefs(refreshedResponseIds(entries));
  return refs.map((reference) => ({
    request: { method: "DELETE" as const, url: reference },
  }));
}

// entries はテンプレート記載の QuestionnaireResponse(とそのシェーマ画像 Binary、
// 回答から生成した Observation)。診療記録本体と同じ transaction Bundle で保存する
// — 先行 POST すると本体を保存しなかったときに QR だけが孤児として残るため
// (saveWithImages と同じ設計)。
//
// 記載を編集し直したときは、前回その回答から生成した Observation を消してから
// 作り直す(単独登録のテンプレート回答と同じ方式。項目と Observation を 1 対 1 で
// 対応付けて差分更新すると、テンプレート側のコード変更で対応が崩れる)。
export async function saveClinicalNote(
  composition: fhir4.Composition,
  entries: fhir4.BundleEntry[],
  etag?: string,
): Promise<FhirResult<fhir4.Composition>> {
  const stale = await staleObservationEntries(entries);
  return saveWithImages(composition, [...stale, ...entries], etag);
}

export function useCreateClinicalNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      composition,
      entries,
    }: {
      composition: fhir4.Composition;
      entries: fhir4.BundleEntry[];
    }) => saveClinicalNote(composition, entries),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

export function useUpdateClinicalNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      composition,
      entries,
      etag,
    }: {
      composition: fhir4.Composition;
      entries: fhir4.BundleEntry[];
      etag: string;
    }) => saveClinicalNote(composition, entries, etag),
    onSuccess: (result: FhirResult<fhir4.Composition>) => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Composition", result.data.id] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

/** useDeleteMicroOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。 */
export const deleteMicroOrderRequest = (srId: string) =>
  deleteOrderWithItems(srId, {
    itemsOf: microOrderItemRequests,
    build: ({ srId, itemIds }) => buildMicroOrderDeleteBundle(srId, itemIds),
  });

export function useDeleteMicroOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMicroOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}
