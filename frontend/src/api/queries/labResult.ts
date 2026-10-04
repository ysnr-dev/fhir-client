import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentPractitioner } from "../authQueries";
import {
  buildLabResultBundle,
  buildLabResultDeleteBundle,
  buildLabResultUpdateBundle,
  isLabelSpecimen,
  type LabResultFormValues,
  type LabResultSubject,
  type LabResultSummary,
  observationIdsFromReport,
  type SpecimenRef,
  splitLabResultDetailBundle,
  summarizeDiagnosticReport,
} from "../../fhir/labResultHelpers";
import { LAB_PANIC_TASK_CODE } from "../../fhir/labPanicHelpers";
import { RESULT_REVIEW_TASK_CODE } from "../../fhir/resultReviewHelpers";
import { approvalTransactionEntries } from "../notificationActions";
import {
  isOrderItemRequest,
  LAB_ORDER_TYPE,
  labOrderItemRequests,
  labOrderItems,
  labOrderLabel,
  serviceRequestsOf,
} from "../../fhir/labOrderHelpers";
import { MICRO_ORDER_TYPE, microOrderLabel } from "../../fhir/microOrderHelpers";
import { departmentOf, ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { postBundle, readHistory, searchResource } from "../fhirClient";
import {
  fetchDistinctDates,
  HISTORY_COUNT,
  NOTIFICATION_TASK_KEY,
  resourcesOfType,
  searchAllPages,
} from "./core";
import { fetchLabelSpecimens } from "./injection";
import { fetchReportTasks } from "./notification";
import { invalidateProvenance, useOrderEnterer, useWithOrderProvenance } from "./provenance";
import { withVersionLock } from "../../fhir/shared";

// ---- 検査結果に紐付けるオーダー(検体検査・細菌検査・病理)の候補 ----

// 上流 fhir-server の _count 上限 500 を 1 ページとして順に辿る。
const LAB_ORDER_CANDIDATE_PAGE = 500;
// オーダーが極端に多い患者での暴走防止。
const LAB_ORDER_CANDIDATE_MAX_PAGES = 2;
// プルダウンに並べる未紐付けオーダーの上限。これだけ集まったら読むのをやめる。
const LAB_ORDER_CANDIDATE_LIMIT = 50;

/** 検査結果の登録画面で選ばせるオーダー 1 件。 */
export interface LabOrderCandidate {
  id: string;
  /** 「2026-08-09 末梢血液一般検査・CRP」のような選択肢の表示。 */
  label: string;
  /** すでに紐付いている検査結果の id。空なら結果がまだ登録されていない。 */
  reportId: string;
  /** オーダーの依頼科。紐付けた検査結果の診療科として採用する。 */
  departmentId: string;
  departmentName: string;
  /** オーダーの依頼医。パニック値(緊急異常値)の通知の宛先にする。無ければ宛先なし。 */
  requester?: fhir4.Reference;
}

// 患者のオーダー(ヘッダ)のうち、指定した種別のものを新しい順に集める。ラベルの
// 組み立てだけがオーダー種別ごとに異なるので、そこを差し替えられるようにしている。
//
// 明細は選択肢のラベルに使うので `_revinclude:iterate=ServiceRequest:based-on` で、
// 「結果が既に登録されているか」は `_revinclude=DiagnosticReport:based-on` で
// 同じ応答に添えてもらう。
export async function fetchOrderCandidates(
  patientId: string,
  orderTypeCode: string,
  buildLabel: (header: fhir4.ServiceRequest, itemRequests: fhir4.ServiceRequest[]) => string,
  options: { occurrence?: string; completedOnly?: boolean } = {},
): Promise<LabOrderCandidate[]> {
  const candidates: LabOrderCandidate[] = [];

  for (let page = 0; page < LAB_ORDER_CANDIDATE_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("patient", `Patient/${patientId}`);
    params.set("category", `${ORDER_TYPE_SYSTEM}|${orderTypeCode}`);
    // 明細(基づく先を持つ ServiceRequest)はオーダーそのものではないので除く。
    params.set("based-on:missing", "true");
    // 日付だけの値は上流が施設のタイムゾーンで日の範囲に広げて解釈する。
    if (options.occurrence) params.set("occurrence", options.occurrence);
    // 部門の進捗(Task)が実施済のものだけ。読影・所見は実施した後にしか書けない。
    if (options.completedOnly) params.set("_has:Task:focus:status", "completed");
    params.set("_count", String(LAB_ORDER_CANDIDATE_PAGE));
    params.set("_offset", String(page * LAB_ORDER_CANDIDATE_PAGE));
    params.set("_sort", "-authoredon");
    params.set("_revinclude:iterate", "ServiceRequest:based-on");
    params.set("_revinclude", "DiagnosticReport:based-on");

    const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);

    const serviceRequests = serviceRequestsOf(bundle);
    // オーダー id → そのオーダーを元にした検査結果の id。
    const reportIdByOrderId = new Map<string, string>();
    for (const entry of bundle.entry ?? []) {
      const report = entry.resource;
      if (report?.resourceType !== "DiagnosticReport") continue;
      for (const reference of (report as fhir4.DiagnosticReport).basedOn ?? []) {
        const orderId = reference.reference?.startsWith("ServiceRequest/")
          ? reference.reference.split("/")[1]
          : undefined;
        if (orderId && report.id) reportIdByOrderId.set(orderId, report.id);
      }
    }

    // ヘッダ(= 検索にヒットした分)だけを数える。明細と検査結果も混ざって返るため。
    const headers = serviceRequests.filter((sr) => !isOrderItemRequest(sr));
    for (const header of headers) {
      if (!header.id) continue;
      candidates.push({
        id: header.id,
        label: buildLabel(header, labOrderItemRequests(serviceRequests, header.id)),
        reportId: reportIdByOrderId.get(header.id) ?? "",
        requester: header.requester,
        ...departmentOf(header),
      });
    }

    if (headers.length < LAB_ORDER_CANDIDATE_PAGE) break;
    if (candidates.filter((c) => !c.reportId).length >= LAB_ORDER_CANDIDATE_LIMIT) break;
  }

  return candidates;
}

export function fetchLabOrderCandidates(
  patientId: string,
  options: { occurrence?: string } = {},
): Promise<LabOrderCandidate[]> {
  return fetchOrderCandidates(
    patientId,
    LAB_ORDER_TYPE.code,
    (header, itemRequests) => labOrderLabel(header, labOrderItems(header, itemRequests)),
    options,
  );
}

function fetchMicroOrderCandidates(patientId: string): Promise<LabOrderCandidate[]> {
  return fetchOrderCandidates(patientId, MICRO_ORDER_TYPE.code, microOrderLabel);
}

// 「すでに結果が登録されているオーダーは出さないが、編集中の結果自身が紐付けている
// オーダーは残す(外して保存し直すつもりがないのに選択が消えてしまわないように
// するため)」を検体検査・細菌検査で共通に行う。
export function useOrderCandidatesQuery(
  queryKey: unknown[],
  fetch: (patientId: string) => Promise<LabOrderCandidate[]>,
  patientId: string | undefined,
  currentReportId?: string,
) {
  // 検査結果の登録・更新・削除でも紐付け状況が変わるので、それらの
  // invalidateQueries(["ServiceRequest", "search"]) で無効化されるキーにしている。
  const query = useQuery({
    queryKey,
    queryFn: () => fetch(patientId as string),
    enabled: Boolean(patientId),
    staleTime: 30_000,
  });

  return {
    candidates: (query.data ?? []).filter(
      (candidate) => !candidate.reportId || candidate.reportId === currentReportId,
    ),
    isLoading: query.isLoading,
    error: query.error,
  };
}

/** 検査結果に紐付ける検体検査オーダーの候補。 */
export function useLabOrderCandidates(
  patientId: string | undefined,
  currentReportId?: string,
) {
  return useOrderCandidatesQuery(
    ["ServiceRequest", "search", "lab-order-candidates", patientId],
    fetchLabOrderCandidates,
    patientId,
    currentReportId,
  );
}

/** 細菌検査結果に紐付ける細菌検査オーダーの候補。 */
export function useMicroOrderCandidates(
  patientId: string | undefined,
  currentReportId?: string,
) {
  return useOrderCandidatesQuery(
    ["ServiceRequest", "search", "micro-order-candidates", patientId],
    fetchMicroOrderCandidates,
    patientId,
    currentReportId,
  );
}

/**
 * オーダーの新規登録。名前は処方由来だが、**16 種別すべての登録がこのフックを通る**
 * (組み立て済みの transaction Bundle を受け取って POST するだけなので共用している)。
 * 来歴(入力者)は useWithOrderProvenance で添える。
 */
export function useCreatePrescription() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      invalidateProvenance(queryClient);
      // 持参薬の継続は、持参薬の更新と鑑別済の通知を処方と同じ transaction で書く。
      queryClient.invalidateQueries({ queryKey: ["MedicationStatement"] });
      queryClient.invalidateQueries({ queryKey: ["Task", "search"] });
    },
  });
}

/**
 * そのオーダーの来歴。詳細を開いたときだけ引く(カルテ本流は 1 ページ 20 件・先読みは
 * 100 件 × 2 本をカルテを開くたびに叩くので、そこに _revinclude を足すと編集回数ぶん膨らむ。
 * 入力者は詳細でだけ見えればよい情報)。
 */
export function useOrderProvenance(serviceRequestId: string | undefined) {
  const params = new URLSearchParams();
  if (serviceRequestId) params.set("target", `ServiceRequest/${serviceRequestId}`);
  params.set("_sort", "recorded");
  params.set("_count", "50");

  return useQuery({
    queryKey: ["Provenance", "search", "order", serviceRequestId],
    queryFn: () => searchResource<fhir4.Provenance>("Provenance", params),
    enabled: Boolean(serviceRequestId),
  });
}

/**
 * 承認。渡された来歴に verifier と署名を足し、その来歴あての承認待ちの通知を対応済みにして、
 * 1 つの transaction で PUT する(1 オーダーに登録と編集の承認待ちが並んでいれば、まとめて
 * 「いまの内容を確認した」ことになる)。来歴は id で渡して中で最新を読み直す
 * (一覧を開いたままにしていても、古い内容で上書きしない)。
 * 承認できるのは author(指示医師)本人だけで、判定は呼ぶ側(canApprove)が行う。
 */
export function useApproveOrderProvenances() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: async (provenanceIds: string[]) => {
      if (!enterer) throw new Error("医療従事者に紐付いたアカウントでログインしてください");
      const entry = await approvalTransactionEntries(provenanceIds, enterer);
      if (entry.length === 0) return null;
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    retry: false,
    onSuccess: () => invalidateProvenance(queryClient),
  });
}

/** 承認ボタンを出すかどうか。ログイン中の医療従事者が指示医師(author)本人のときだけ。 */
export function useCanApproveOrder(authorReference: string | undefined): boolean {
  const { practitionerId } = useCurrentPractitioner();
  return Boolean(practitionerId && authorReference === `Practitioner/${practitionerId}`);
}

export function useUpdatePrescription() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      invalidateProvenance(queryClient);
    },
  });
}

/** 保存済みの検査結果(レポート + 結果 + 検体)を 1 リクエストで読む。 */
export function fetchLabResultDetail(reportId: string) {
  const params = new URLSearchParams();
  params.set("_id", reportId);
  params.append("_include", "DiagnosticReport:result");
  params.append("_include", "DiagnosticReport:specimen");

  return searchResource<fhir4.Resource>("DiagnosticReport", params);
}

export function useLabResultDetail(reportId: string | undefined) {
  return useQuery({
    queryKey: ["DiagnosticReport", "detail", reportId],
    queryFn: () => fetchLabResultDetail(reportId as string),
    enabled: Boolean(reportId),
  });
}

// 上流 fhir-server の _count 上限が 500 のため、それを 1 ページとして順に辿る。
const LAB_RESULT_ORDER_PAGE = 500;
// 患者あたりの検査結果が極端に多い場合の暴走防止（最大 1000 件まで前後移動できる）。
const LAB_RESULT_ORDER_MAX_PAGES = 2;

// 検体採取日の降順で全検査結果の要約(id・採取日・入外区分)を取得する。
// 上流の _sort は同値時に id 昇順で安定するため、ページ境界をまたいでも並びが一致する。
// category は検体検査(LAB)・細菌検査(MB)の別。
async function fetchLabResultSummaries(
  patientId: string,
  category: string,
): Promise<LabResultSummary[]> {
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  params.set("category", category);
  params.set("_sort", "-date");
  // 要約に使う要素だけ返させ、検査項目の参照(result)などの本文は省く。
  // 上流の _elements はトップレベルの JSON キー名の一致で切り出すため、
  // choice 型は基底名(effective)ではなく実際のキー名で指定する。
  // extension は診療科(ローカル拡張)を、basedOn は元のオーダーを要約に含めるために要る。
  params.set("_elements", "id,effectiveDateTime,category,extension,basedOn");
  const { matches } = await searchAllPages<fhir4.DiagnosticReport>("DiagnosticReport", params, {
    page: LAB_RESULT_ORDER_PAGE,
    maxPages: LAB_RESULT_ORDER_MAX_PAGES,
  });
  const summaries = matches.map(summarizeDiagnosticReport);

  return summaries;
}

// 検体採取日ペイン・内容ページの「前へ/次へ」の双方で使う検査結果の並び。
export function useResultSummariesQuery(category: string, patientId: string | undefined) {
  // 作成・更新・削除時の invalidateQueries(["DiagnosticReport", "search"]) で
  // まとめて無効化されるよう search 配下のキーにしている。
  return useQuery({
    queryKey: ["DiagnosticReport", "search", "order", category, patientId],
    queryFn: () => fetchLabResultSummaries(patientId as string, category),
    enabled: Boolean(patientId),
    // 前後移動のたびにページが再マウントされるため、連打で毎回引き直さないよう
    // 少しだけ寝かせる。更新・削除時は invalidateQueries 側で無効化される。
    staleTime: 30_000,
  });
}

/** 検査結果タブの検体採取日ペイン用。全検査結果の要約を新しい順で返す。 */
export function useLabResultEntries(patientId: string | undefined) {
  const query = useResultSummariesQuery("LAB", patientId);
  return {
    entries: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

/** 細菌検査タブの検体採取日ペイン用。全細菌検査結果の要約を新しい順で返す。 */
export function useMicroResultEntries(patientId: string | undefined) {
  const query = useResultSummariesQuery("MB", patientId);
  return {
    entries: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

// ---- 時系列表示 ----

// 上流 fhir-server の _count 上限 500 を 1 ページとして順に辿る。
const LAB_TIMELINE_PAGE = 500;
// 同一期間内の件数が極端に多い場合の暴走防止。
const LAB_TIMELINE_MAX_PAGES = 2;

export interface LabTimelineResources {
  reports: fhir4.DiagnosticReport[];
  observations: fhir4.Observation[];
}

// 時系列表示は「直近 dateCount 回分の検体採取日」を横軸にする。
// まず $distinct-dates で直近 dateCount 個の採取日を集計し、いちばん古い採取日
// 以降のレポートを Observation ごと(_include)取得する。通常 2 リクエストに収まる。
async function fetchLabTimelineResources(
  patientId: string,
  dateCount: number,
): Promise<LabTimelineResources> {
  const dateParams = new URLSearchParams();
  dateParams.set("patient", `Patient/${patientId}`);
  dateParams.set("category", "LAB");
  const { dates } = await fetchDistinctDates("DiagnosticReport", dateParams, "date", {
    limit: dateCount,
  });
  if (dates.length === 0) return { reports: [], observations: [] };

  // 上流は日付をローカルタイムゾーンで解釈するので、下限はその日の 0 時になる。
  const oldest = dates[dates.length - 1];
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  params.set("category", "LAB");
  params.set("date", `ge${oldest}`);
  params.set("_sort", "-date");
  params.set("_include", "DiagnosticReport:result");
  const { matches, bundles } = await searchAllPages<fhir4.DiagnosticReport>(
    "DiagnosticReport",
    params,
    { page: LAB_TIMELINE_PAGE, maxPages: LAB_TIMELINE_MAX_PAGES },
  );
  return {
    reports: matches,
    observations: bundles.flatMap((bundle) =>
      resourcesOfType<fhir4.Observation>(bundle, "Observation"),
    ),
  };
}

export function useLabResultTimeline(patientId: string | undefined, dateCount: number) {
  // 作成・更新・削除時の invalidateQueries(["DiagnosticReport", "search"]) で
  // まとめて無効化されるよう search 配下のキーにしている。
  return useQuery({
    queryKey: ["DiagnosticReport", "search", "timeline", patientId, dateCount],
    queryFn: () => fetchLabTimelineResources(patientId as string, dateCount),
    enabled: Boolean(patientId) && dateCount > 0,
    // 表示数変更のたびに画面が空にならないよう前回結果を残す。
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** 選んだ検査項目の版履歴。訂正で値がどう変わったかを読むために引く。 */
export interface LabObservationHistory {
  id: string;
  /** 新しい版から順(上流の _history の並びのまま)。 */
  versions: fhir4.Observation[];
}

// 版履歴は 1 項目 1 リクエストになるので、内容表示で選んだ項目だけを引く
// (1 レポートの全項目を引くと数十回の照会になる)。
export function useLabObservationHistories(observationIds: string[]) {
  return useQuery({
    queryKey: ["Observation", "history", observationIds.join(",")],
    queryFn: async (): Promise<LabObservationHistory[]> => {
      const params = new URLSearchParams();
      params.set("_count", String(HISTORY_COUNT));
      const results = await Promise.all(
        observationIds.map((id) => readHistory<fhir4.Observation>("Observation", id, params)),
      );
      return results.map(({ data }, index) => ({
        id: observationIds[index],
        versions: (data.entry ?? [])
          .map((entry) => entry.resource)
          .filter((r): r is fhir4.Observation => r?.resourceType === "Observation"),
      }));
    },
    enabled: observationIds.length > 0,
  });
}

// 検査結果を保存・削除するとオーダーの紐付け状況が変わるため、
// 検体検査オーダーの候補(["ServiceRequest", "search"] 配下)も無効化する。
export function useCreateLabResult() {
  const queryClient = useQueryClient();
  return useMutation({
    // オーダーに紐付く結果は、ラベル発行が作った管の Specimen を参照するので、
    // 組み立ての前にオーダーの管を引く(labResultHelpers の planSpecimens を参照)。
    // subject(性別・生年月日)は基準値の適用に使う。無ければ referenceRange を書かない。
    // owner はパニック値の通知の宛先(オーダーの依頼医)。
    mutationFn: async ({
      values,
      patientId,
      subject,
      owner,
    }: {
      values: LabResultFormValues;
      patientId: string;
      subject?: LabResultSubject;
      owner?: fhir4.Reference;
    }) => {
      const labelSpecimens = await fetchLabelSpecimens(values.orderId);
      return postBundle(buildLabResultBundle(values, patientId, labelSpecimens, subject, { owner }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

export function useUpdateLabResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      values,
      patientId,
      reportId,
      originalObservationIds,
      originalSpecimens,
      subject,
      owner,
      report,
    }: {
      values: LabResultFormValues;
      patientId: string;
      reportId: string;
      originalObservationIds: string[];
      originalSpecimens: SpecimenRef[];
      subject?: LabResultSubject;
      owner?: fhir4.Reference;
      /** 画面が読み込んだ報告書。渡すと、その版からの更新として楽観ロックが効く。 */
      report?: fhir4.DiagnosticReport;
    }) => {
      const [labelSpecimens, reportTasks] = await Promise.all([
        fetchLabelSpecimens(values.orderId),
        // 訂正でパニック値が出た/直ったときに通知を出し直す・取り下げるため、
        // また訂正した結果を読み直してもらうため、この結果に付いている通知を先に引く。
        fetchReportTasks(reportId, [LAB_PANIC_TASK_CODE.code, RESULT_REVIEW_TASK_CODE.code]),
      ]);
      const existingPanicTask = reportTasks.get(LAB_PANIC_TASK_CODE.code);
      const existingReviewTask = reportTasks.get(RESULT_REVIEW_TASK_CODE.code);
      return postBundle(
        withVersionLock(
          buildLabResultUpdateBundle(
            values,
            patientId,
            reportId,
            originalObservationIds,
            originalSpecimens,
            labelSpecimens,
            subject,
            { owner, existingPanicTask, existingReviewTask },
          ),
          report,
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

export function useDeleteLabResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: string) => {
      // 削除対象の Observation / Specimen は詳細と同じ検索で実体ごと引く。
      // Specimen は結果側が所有するものだけを消す(ラベル由来はオーダー側の
      // 台帳なので、結果を消しても発行・到着の記録は残す)。
      const params = new URLSearchParams();
      params.set("_id", reportId);
      params.append("_include", "DiagnosticReport:result");
      params.append("_include", "DiagnosticReport:specimen");
      const { data: bundle } = await searchResource<fhir4.Resource>("DiagnosticReport", params);
      const { report, specimens } = splitLabResultDetailBundle(bundle);
      if (!report) throw new Error("検査結果が見つかりません");
      const ownedSpecimenIds = specimens
        .filter((s) => !isLabelSpecimen(s))
        .map((s) => s.id)
        .filter((id): id is string => Boolean(id));
      return postBundle(
        buildLabResultDeleteBundle(reportId, observationIdsFromReport(report), ownedSpecimenIds),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

/**
 * 検査結果(Observation)が載っている報告書(DiagnosticReport)の id。チャートの点から
 * 検査結果内容を開くのに使う。検索が効かずに別の報告書が返っても開かないよう、
 * result に本当に含まれているかを確かめる。見つからなければ空。
 */
export async function findLabReportIdOf(observationId: string): Promise<string> {
  const params = new URLSearchParams();
  params.set("result", `Observation/${observationId}`);
  params.set("_elements", "id,result");
  params.set("_count", "1");
  const { data: bundle } = await searchResource<fhir4.DiagnosticReport>("DiagnosticReport", params);
  const report = resourcesOfType<fhir4.DiagnosticReport>(bundle, "DiagnosticReport").find((entry) =>
    entry.result?.some((reference) => reference.reference === `Observation/${observationId}`),
  );
  return report?.id ?? "";
}
