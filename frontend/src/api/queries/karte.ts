import { DPC_FORM1_QUESTIONNAIRE } from "../../fhir/dpcForm1Helpers";
import { useMemo } from "react";
import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { groupVitalEntries, VITAL_ENTRY_SYSTEM, vitalDeleteBundle, vitalSaveBundle } from "../../fhir/vitalHelpers";
import { KARTE_NOTE_TYPE_SEARCH } from "../../fhir/clinicalNoteHelpers";
import { compareKarteDaysDesc, orderCardDay } from "../../fhir/karteTimeline";
import { PATHWAY_MARKER_CODE, PATHWAY_MARKER_SYSTEM } from "../../fhir/pathwayApplyHelpers";
import { buildPathwayEvaluationCards, type PathwayEvaluationCard } from "../../fhir/pathwayKarteHelpers";
import { EVALUATION_ITEM_SYSTEM } from "../../fhir/pathwayEvaluationHelpers";
import { today } from "../../lib/dates";
import { ORDER_TYPE_SYSTEM } from "../../fhir/prescriptionHelpers";
import { NURSING_ORDER_TYPE } from "../../fhir/nursingOrderHelpers";
import { postBundle, searchResource } from "../fhirClient";
import { fetchDistinctDates, resourcesOfType, searchAllPages } from "./core";
import { hasRelation } from "./patient";

// ---- カルテ画面のタイムライン ----
//
// 診療記録・処方・テンプレート回答を 1 本の時系列にまとめて無限スクロールする。
// 3 つは別リソースなので個別に無限クエリを持ち、表示側(buildKarteTimeline)が
// 「どこまで表示してよいか」を判断する。
//
// キーはいずれも既存の作成・更新・削除が無効化する ["<型>", "search"] 配下に置く
// (登録後にタイムラインが自動で再取得される)。
const KARTE_PAGE = 20;

// 先読み(日付未定・未来の予定)の 1 ページの件数と、辿るページ数の上限。どちらも未処理の
// 仕事なので溜まらない前提だが、1 ページを超えても取りこぼさないようページを辿る。
const KARTE_PENDING_COUNT = 100;
const KARTE_PENDING_MAX_PAGES = 5;

/**
 * カルテのオーダー検索から外す種別。看護指示はカルテのカードにせず指示簿タブで見せる
 * (karteTimeline 側でも落としているが、サーバー側で外さないと診療日ペインに
 * 看護指示しか無い日が空の日として並ぶ)。
 */
const KARTE_EXCLUDED_ORDER_TYPE_TOKENS = `${ORDER_TYPE_SYSTEM}|${NURSING_ORDER_TYPE.code}`;

// _include / _revinclude の関連リソースも entry に混ざるため、次ページのオフセットは
// entry 数ではなく _count 固定で進める。
function karteNextOffset(bundle: fhir4.Bundle | undefined, lastOffset: number): number | undefined {
  return hasRelation(bundle, "next") ? lastOffset + KARTE_PAGE : undefined;
}

/**
 * プロブレム絞り込みの検索値。3 リソースとも参照検索なので、カンマ区切りで OR に
 * なる(親プロブレムを選んだときは下位プロブレムの分も並ぶ)。
 *
 * null は絞り込みなし、undefined は「まだプロブレムが確定していない」= 取得を
 * 始めない、の意味。絞り込み前の並びを一瞬見せないための区別。
 */
export type KarteProblemFilter = string[] | null | undefined;

function problemSearchValue(problemIds: string[]): string {
  return problemIds.map((id) => `Condition/${id}`).join(",");
}

// クエリキーは値が変われば別のページング列になる。絞り込みごとに 1 列を持つので、
// 絞り込みの切り替えは先頭ページからの読み直しになる。
function problemQueryKey(problemIds: KarteProblemFilter): string | null {
  return problemIds?.length ? problemIds.join(",") : null;
}

/**
 * 「自科」の絞り込み。記録した診療科(オーダーは依頼科)の id で、null は絞り込みなし。
 * 診療記録・オーダー・テンプレート回答・バイタルとも同じローカル拡張を department で引く。
 */
export type KarteDepartmentFilter = string | null;

function setDepartment(params: URLSearchParams, departmentId: KarteDepartmentFilter) {
  if (departmentId) params.set("department", `Organization/${departmentId}`);
}

export function useKarteClinicalNotesInfinite(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
  departmentId: KarteDepartmentFilter = null,
) {
  return useInfiniteQuery({
    queryKey: ["Composition", "search", "karte", patientId, problemQueryKey(problemIds), departmentId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("subject", `Patient/${patientId}`);
      params.set("type", KARTE_NOTE_TYPE_SEARCH);
      // 対象プロブレムは問題リストセクション(LOINC 11450-4)の section.entry に持つので、
      // R4 標準の entry で引ける(参照検索のカンマは OR)。
      if (problemIds?.length) params.set("entry", problemSearchValue(problemIds));
      setDepartment(params, departmentId);
      params.set("_count", String(KARTE_PAGE));
      params.set("_offset", String(pageParam));
      params.set("_sort", "-date");
      // _summary は付けない。カルテは本文を
      // 表示し、テンプレート回答の重複判定にも section の参照拡張が要るため。
      return searchResource<fhir4.Composition>("Composition", params);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) => karteNextOffset(lastPage.data, lastOffset),
    enabled: Boolean(patientId) && problemIds !== undefined,
  });
}

/**
 * カルテのオーダー本流。**取得軸 = 配置軸 = オーダー開始日(occurrence)** で、今日以前を
 * 新しい順にページングする。カードを置く日(karteTimeline の orderCardDay)と同じ軸で
 * 読むから、「この日より新しい日は読み切った」というカットオフ判定が厳密に成り立つ
 * (登録日時 authoredOn で読むと、先に登録した開始日の新しいオーダーが、その日を
 * 読み切った後に届いて欠ける)。今日より後の予定と日付未定は useKartePendingOrders が
 * 全件先読みする。
 */
export function useKartePrescriptionsInfinite(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
  departmentId: KarteDepartmentFilter = null,
) {
  // 日を跨いで開きっぱなしのタブが古い境界で読み続けないよう、キーに今日を含める。
  const todayDay = today();
  return useInfiniteQuery({
    queryKey: ["ServiceRequest", "search", "karte", patientId, problemQueryKey(problemIds), departmentId, todayDay],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      // オーダーの対象プロブレムは reasonReference(R4 標準)。明細も親から
      // 引き継いだ理由を持つが、下の based-on:missing でヘッダだけに絞られる。
      if (problemIds?.length) params.set("reason-reference", problemSearchValue(problemIds));
      setDepartment(params, departmentId);
      params.set("_count", String(KARTE_PAGE));
      params.set("_offset", String(pageParam));
      params.set("_sort", "-occurrence");
      // 今日以前の開始日。上流は日付だけの値をローカル日で解釈するので、le{今日} で
      // 「今日の終わりまで」になる。先読み側の gt{今日} と合わせて過不足なく分割される。
      params.set("occurrence", `le${todayDay}`);
      params.set("category:not", KARTE_EXCLUDED_ORDER_TYPE_TOKENS);
      // 検体検査・放射線検査は明細も ServiceRequest なので、オーダーのヘッダだけを
      // 1 ページの対象にする(明細がカードとして紛れ込まず、ページ数も項目数に
      // 左右されない)。
      params.set("based-on:missing", "true");
      // カルテは薬剤名・検査項目名まで表示するので、処方明細と検体検査・放射線検査の
      // 明細(構成項目まで 2 段)も同じレスポンスで受け取る。
      params.append("_revinclude", "MedicationRequest:based-on");
      // 検体検査のカードから「検査結果表示」を出せるかの判定に、そのオーダーを
      // 元にした検査結果も添えてもらう。
      params.append("_revinclude", "DiagnosticReport:based-on");
      // 検体検査・放射線検査カードの進捗(依頼済・受付済・実施済・中止)と、
      // 放射線検査の実施記録。進捗の Task は部門で code が違うだけなので 1 つで足りる。
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "Procedure:based-on");
      params.append("_revinclude:iterate", "ServiceRequest:based-on");
      // 実施記録にぶら下がる造影剤・被曝線量。Procedure は上の _revinclude で
      // 入ってくるので、その子を :iterate で 1 段先まで展開してもらう。
      params.append("_revinclude:iterate", "MedicationAdministration:part-of");
      params.append("_revinclude:iterate", "Observation:part-of");
      return searchResource<fhir4.Resource>("ServiceRequest", params);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) => karteNextOffset(lastPage.data, lastOffset),
    enabled: Boolean(patientId) && problemIds !== undefined,
  });
}

/**
 * 先読みするオーダー。カルテの本流は開始日(occurrence)が今日以前のものを新しい順に
 * ページングするので、「日付未定のもの」と「開始日が今日より後のもの」はそこに含まれない。
 * 種別で切ると「手術は件数が少ないから全件取れる」という種別依存の理屈になるので、
 * **状態で切って**全件読む。どちらも件数は自然に小さい(未定は未処理の仕事なので溜まらず、
 * 未来の予定も有限)。
 *
 * occurrence を持たないオーダーも occurrence:missing に
 * 入り、タイムライン側で登録日の位置に落ちる。
 */
export function useKartePendingOrders(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
  departmentId: KarteDepartmentFilter = null,
) {
  const enabled = Boolean(patientId) && problemIds !== undefined;

  function baseParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set("patient", `Patient/${patientId}`);
    if (problemIds?.length) params.set("reason-reference", problemSearchValue(problemIds));
    setDepartment(params, departmentId);
    // カードになるのはヘッダだけ(明細は下の :iterate で添えてもらう)。
    params.set("based-on:missing", "true");
    params.set("category:not", KARTE_EXCLUDED_ORDER_TYPE_TOKENS);
    params.set("_include", "ServiceRequest:subject");
    params.append("_revinclude", "MedicationRequest:based-on");
    params.append("_revinclude", "DiagnosticReport:based-on");
    params.append("_revinclude", "Task:focus");
    params.append("_revinclude", "Procedure:based-on");
    params.append("_revinclude:iterate", "ServiceRequest:based-on");
    params.append("_revinclude:iterate", "MedicationAdministration:part-of");
    params.append("_revinclude:iterate", "Observation:part-of");
    return params;
  }

  async function fetchAll(params: URLSearchParams): Promise<fhir4.Bundle[]> {
    const { bundles } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
      page: KARTE_PENDING_COUNT,
      maxPages: KARTE_PENDING_MAX_PAGES,
    });
    return bundles;
  }

  const unscheduled = useQuery({
    queryKey: ["ServiceRequest", "search", "karte-unscheduled", patientId, problemQueryKey(problemIds), departmentId],
    queryFn: () => {
      const params = baseParams();
      params.set("occurrence:missing", "true");
      params.set("_sort", "-authoredon");
      return fetchAll(params);
    },
    enabled,
  });

  const upcoming = useQuery({
    queryKey: ["ServiceRequest", "search", "karte-upcoming", patientId, problemQueryKey(problemIds), departmentId],
    queryFn: () => {
      const params = baseParams();
      // 今日より後の開始日。今日以前は本流(occurrence=le{今日})が読む。
      params.set("occurrence", `gt${today()}`);
      params.set("_sort", "occurrence");
      return fetchAll(params);
    },
    enabled,
  });

  const bundles = useMemo(
    () => [...(unscheduled.data ?? []), ...(upcoming.data ?? [])],
    [unscheduled.data, upcoming.data],
  );

  return {
    bundles,
    error: unscheduled.error ?? upcoming.error ?? null,
    // 先読みが届くとタイムラインの上に日が足されるので、初期位置を決める側が待つ。
    isPending: unscheduled.isPending || upcoming.isPending,
  };
}

export function useKarteQuestionnaireResponsesInfinite(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
  departmentId: KarteDepartmentFilter = null,
) {
  return useInfiniteQuery({
    queryKey: ["QuestionnaireResponse", "search", "karte", patientId, problemQueryKey(problemIds), departmentId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      // 診療記録と同じローカル拡張による絞り込み。
      if (problemIds?.length) params.set("problem", problemSearchValue(problemIds));
      setDepartment(params, departmentId);
      // DPC 様式1 も QuestionnaireResponse だが、カルテの記載ではないので出さない。
      params.set("questionnaire:not", DPC_FORM1_QUESTIONNAIRE);
      params.set("_count", String(KARTE_PAGE));
      params.set("_offset", String(pageParam));
      params.set("_sort", "-authored");
      params.set("_include", "QuestionnaireResponse:questionnaire");
      return searchResource<fhir4.Resource>("QuestionnaireResponse", params);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) => karteNextOffset(lastPage.data, lastOffset),
    enabled: Boolean(patientId) && problemIds !== undefined,
  });
}

// バイタルは 1 回の測定が項目ごとの Observation に分かれるので、identifier で束ねて
// 1 枚のカードにする(groupVitalEntries)。テンプレート回答から抽出した Observation は
// 回答のカードとして既に出るため、derived-from を持つものは除く。
export function useKarteVitalsInfinite(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
  departmentId: KarteDepartmentFilter = null,
) {
  return useInfiniteQuery({
    queryKey: ["Observation", "search", "karte-vital", patientId, problemQueryKey(problemIds), departmentId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", "vital-signs");
      params.set("derived-from:missing", "true");
      if (problemIds?.length) params.set("problem", problemSearchValue(problemIds));
      setDepartment(params, departmentId);
      params.set("_count", String(KARTE_PAGE));
      params.set("_offset", String(pageParam));
      params.set("_sort", "-date");
      return searchResource<fhir4.Observation>("Observation", params);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) => karteNextOffset(lastPage.data, lastOffset),
    enabled: Boolean(patientId) && problemIds !== undefined,
  });
}

/**
 * カルテのタイムラインの「パス評価」(docs/clinical-pathway-design.md §6)。記載のあるアウトカムの評価を
 * 患者ぶん全部読む(1 人の患者で数十件程度なのでページングしない。タイムラインの表示範囲の計算には加わらない)。
 *
 * `Observation?patient&category=パスの印&code=判定` で評価の Observation を引き、basedOn の OAT ユニットを
 * `_include=Observation:based-on` で、その祖先の病日・適用を `_include:iterate=CarePlan:part-of` で同じ応答に揃える。
 *
 * 評価はプロブレムを指さないので、プロブレムで絞り込んでいるときは出さない。
 * キーは評価の記録(useRecordPathwayEvaluation)の読み直しと同じ ["Observation", "search", "pathway"] 配下。
 */
export function useKartePathwayEvaluations(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
) {
  return useQuery({
    queryKey: ["Observation", "search", "pathway", "karte-cards", patientId, problemQueryKey(problemIds)],
    queryFn: async (): Promise<PathwayEvaluationCard[]> => {
      if (problemIds?.length) return [];
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", `${PATHWAY_MARKER_SYSTEM}|${PATHWAY_MARKER_CODE}`);
      params.set("code", `${EVALUATION_ITEM_SYSTEM}|judgement`);
      params.set("_include", "Observation:based-on");
      params.set("_include:iterate", "CarePlan:part-of");
      params.set("_count", "500");
      const { data: bundle } = await searchResource<fhir4.Resource>("Observation", params);
      const observations = resourcesOfType<fhir4.Observation>(bundle, "Observation");
      if (observations.length === 0) return [];
      return buildPathwayEvaluationCards(observations, resourcesOfType<fhir4.CarePlan>(bundle, "CarePlan"));
    },
    enabled: Boolean(patientId) && problemIds !== undefined,
  });
}

// ---- 診療日インデックス ----
//
// 診療日ペインには、タイムラインの読み込み状況に関係なく全診療日を最初から出す。
// 検索条件(プロブレム絞り込みを含む)はタイムラインの各無限クエリと揃えること。
// キーも同じ ["<型>", "search"] 配下に置くので、登録・削除の invalidate で一緒に
// 再取得される。
// 診療日の集合は $distinct-dates のサーバー集計で取る。limit はカルテの左ペインに
// 出す日数の実用上限。
async function fetchKarteDays(
  resourceType: string,
  params: URLSearchParams,
  dateParam: string,
): Promise<string[]> {
  const { dates, hasUndated } = await fetchDistinctDates(resourceType, params, dateParam, {
    limit: 1000,
  });
  // 日付を持たないリソースは空文字で持ち、タイムラインの「日付なし」に揃える。
  return hasUndated ? [...dates, ""] : dates;
}

/** 診療日ペインに出す全診療日(降順)。 */
export function useKarteDayIndex(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
  departmentId: KarteDepartmentFilter = null,
) {
  const enabled = Boolean(patientId) && problemIds !== undefined;
  const problemKey = problemQueryKey(problemIds);

  const notes = useQuery({
    queryKey: ["Composition", "search", "karte-days", patientId, problemKey, departmentId],
    queryFn: () =>
      fetchKarteDays(
        "Composition",
        (() => {
          const params = new URLSearchParams();
          params.set("subject", `Patient/${patientId}`);
          params.set("type", KARTE_NOTE_TYPE_SEARCH);
          if (problemIds?.length) params.set("entry", problemSearchValue(problemIds));
          setDepartment(params, departmentId);
          return params;
        })(),
        "date",
      ),
    enabled,
  });

  // オーダーはすべて開始日(occurrence)にカードを出すので、診療日もその 1 本で数える
  // (タイムラインと同じくヘッダだけ、看護指示は除く)。
  //
  // occurrence を持たないオーダーの置き場は種別で変わる(未定を許す種別は「日付未定」、
  // それ以外は登録日)。サーバー集計は「occurrence が無い」までしか分からないので、
  // 該当があるときだけ種別と登録日を引き直し、タイムラインと同じ orderCardDay で写す
  // —— 写さずに一律「日付未定」に足すと、カードが登録日に出るぶん空の「日付未定」が並ぶ。
  const orders = useQuery({
    queryKey: ["ServiceRequest", "search", "karte-days-occurrence", patientId, problemKey, departmentId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      if (problemIds?.length) params.set("reason-reference", problemSearchValue(problemIds));
      setDepartment(params, departmentId);
      params.set("based-on:missing", "true");
      params.set("category:not", KARTE_EXCLUDED_ORDER_TYPE_TOKENS);
      // fetchDistinctDates は渡した params に集計用の値を足すので、引き直し用に写しを渡す。
      const { dates, hasUndated } = await fetchDistinctDates(
        "ServiceRequest",
        new URLSearchParams(params),
        "occurrence",
        { limit: 1000 },
      );
      if (!hasUndated) return dates;

      params.set("occurrence:missing", "true");
      params.set("_elements", "category,authoredOn");
      params.set("_count", String(KARTE_PENDING_COUNT));
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const undated = resourcesOfType<fhir4.ServiceRequest>(bundle, "ServiceRequest");
      return [...dates, ...undated.map(orderCardDay)];
    },
    enabled,
  });

  const responses = useQuery({
    queryKey: ["QuestionnaireResponse", "search", "karte-days", patientId, problemKey, departmentId],
    queryFn: () =>
      fetchKarteDays(
        "QuestionnaireResponse",
        (() => {
          const params = new URLSearchParams();
          params.set("patient", `Patient/${patientId}`);
          if (problemIds?.length) params.set("problem", problemSearchValue(problemIds));
          setDepartment(params, departmentId);
          params.set("questionnaire:not", DPC_FORM1_QUESTIONNAIRE);
          return params;
        })(),
        "authored",
      ),
    enabled,
  });

  const vitals = useQuery({
    queryKey: ["Observation", "search", "karte-days", patientId, problemKey, departmentId],
    queryFn: () =>
      fetchKarteDays(
        "Observation",
        (() => {
          const params = new URLSearchParams();
          params.set("patient", `Patient/${patientId}`);
          params.set("category", "vital-signs");
          params.set("derived-from:missing", "true");
          if (problemIds?.length) params.set("problem", problemSearchValue(problemIds));
          setDepartment(params, departmentId);
          return params;
        })(),
        "date",
      ),
    enabled,
  });

  const queries = [notes, orders, responses, vitals];
  const days = useMemo(() => {
    const merged = new Set<string>();
    for (const list of [notes.data, orders.data, responses.data, vitals.data]) {
      for (const day of list ?? []) merged.add(day);
    }
    return Array.from(merged).sort(compareKarteDaysDesc);
  }, [notes.data, orders.data, responses.data, vitals.data]);

  return {
    days,
    isLoading: queries.some((q) => q.isPending),
    error: queries.find((q) => q.error)?.error ?? null,
  };
}

/** 編集対象の測定 1 回分。identifier で束ねてあるので 1 検索で全項目そろう。 */
export function useVitalEntry(entryId: string | undefined) {
  return useQuery({
    queryKey: ["Observation", "search", "vital-entry", entryId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("identifier", `${VITAL_ENTRY_SYSTEM}|${entryId}`);
      params.set("_count", "50");
      const { data } = await searchResource<fhir4.Observation>("Observation", params);
      const observations = (data.entry ?? [])
        .map((entry) => entry.resource)
        .filter((r): r is fhir4.Observation => r?.resourceType === "Observation");
      return groupVitalEntries(observations)[0] ?? null;
    },
    enabled: Boolean(entryId),
  });
}

function invalidateVitals(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
}

// 経過表は「基準日から 1 週間」を横軸にする(1 日の中は測定ごとに列が分かれる)。
// 期間で絞った Observation をまとめて取る。1 回の測定が 8 件前後に分かれるので、
// 1 週間でも数百件になりうる。ページングで取り切る。
const VITAL_FLOWSHEET_PAGE = 500;
// 1 か月表示だと、測定の多い患者で 1000 件を超えうるので余裕を持たせる。
const VITAL_FLOWSHEET_MAX_PAGES = 4;

// 経過表に載せる Observation の区分。手入力・テンプレート抽出のバイタル(vital-signs)に
// 加えて、看護指示の観察結果(order-type の nursing。nursingPerformHelpers)も同じ表で
// 時系列に読めるようにする。カルテのバイタルカードと診療日の索引
// (useKarteVitalsInfinite / useKarteDayIndex)は vital-signs のままにしてある
// (看護観察を混ぜるとカードにならない Observation で診療日だけが増える)。
const VITAL_FLOWSHEET_CATEGORY = `vital-signs,${NURSING_ORDER_TYPE.code}`;

async function fetchVitalFlowsheetObservations(
  patientId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<fhir4.Observation[]> {
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  params.set("category", VITAL_FLOWSHEET_CATEGORY);
  // 日付だけの値は上流が施設のタイムゾーンで日の範囲に広げて解釈する。
  params.append("date", `ge${rangeStart}`);
  params.append("date", `le${rangeEnd}`);
  params.set("_sort", "date");
  const { matches } = await searchAllPages<fhir4.Observation>("Observation", params, {
    page: VITAL_FLOWSHEET_PAGE,
    maxPages: VITAL_FLOWSHEET_MAX_PAGES,
  });
  return matches;
}

export function useVitalFlowsheet(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    // 登録・更新・削除の invalidateQueries(["Observation", "search"]) でまとめて
    // 無効化されるよう search 配下のキーにしている。
    queryKey: ["Observation", "search", "vital-flowsheet", patientId, rangeStart, rangeEnd],
    queryFn: () => fetchVitalFlowsheetObservations(patientId ?? "", rangeStart, rangeEnd),
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
    placeholderData: keepPreviousData,
  });
}

export function useSaveVitalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      observations,
      existingObservationIds,
    }: {
      observations: fhir4.Observation[];
      existingObservationIds?: string[];
    }) => postBundle(vitalSaveBundle(observations, existingObservationIds)),
    onSuccess: () => invalidateVitals(queryClient),
  });
}

export function useDeleteVitalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (observationIds: string[]) => postBundle(vitalDeleteBundle(observationIds)),
    onSuccess: () => invalidateVitals(queryClient),
  });
}
