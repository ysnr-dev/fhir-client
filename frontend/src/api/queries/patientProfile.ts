import { useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { referenceId } from "../../fhir/shared";
import { HAS_LAB_MAPPED_TYPES, type InfectionRow, summarizeInfections } from "../../fhir/infectionHelpers";
import { PRESCRIPTION_CATEGORY_SYSTEM } from "../../fhir/prescriptionHelpers";
import { buildQuestionnaire, collectPendingImageEntries } from "../../fhir/questionnaireHelpers";
import { questionnaireCanonical } from "../../fhir/questionnaireResponseHelpers";
import {
  buildQuestionnaireExport,
  buildTransferExport,
  downloadQuestionnaireExport,
  parseTransferImport,
} from "../../fhir/questionnaireTransfer";
import { observationExtractEnabled, responseDeleteBundle, responseSaveBundle } from "../../fhir/observationExtract";
import { resourceFromBundleResponse } from "../../fhir/schemaImage";
import { createReportLayout, fetchReportLayout, fetchReportLayouts, updateReportLayout } from "../adminClient";
import {
  createResource,
  deleteResource,
  fetchBinaryImage,
  type FhirResult,
  postBundle,
  readResource,
  searchResource,
  updateResource,
} from "../fhirClient";
import { saveWithImages } from "./core";
import { hasRelation } from "./patient";

// ---- 診療上の注意(Flag) ----

const FLAG_COUNT = 20;

/**
 * カルテのプロファイルタブに出す一覧。既定は有効なものだけで、
 * 「終了したものも表示」を選ぶと全件になる。
 */
export function useFlagSearch(
  patientId: string | undefined,
  offset: number,
  activeOnly: boolean,
) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  if (activeOnly) params.set("status", "active");
  params.set("_count", String(FLAG_COUNT));
  params.set("_offset", String(offset));
  // 一覧に出しているのは期間なので、開始日の新しい順に並べる。
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Flag", "search", patientId, activeOnly, offset],
    queryFn: () => searchResource<fhir4.Flag>("Flag", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: FLAG_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

/**
 * 患者帯のピクトグラム用。有効な注意を 1 回の検索でまとめて取る
 * (帯はページングしないので _count を大きめに取り、件数で切らない)。
 */
export function useActiveFlags(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("status", "active");
  params.set("_count", "100");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Flag", "search", patientId, "active"],
    queryFn: () => searchResource<fhir4.Flag>("Flag", params),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });

  const flags =
    query.data?.data.entry?.map((e) => e.resource).filter((r): r is fhir4.Flag => Boolean(r)) ?? [];

  return { ...query, flags };
}

// ---- 複数患者の一括取得(病棟マップのベッドカード用) ----
//
// 患者帯は 1 人ぶんを個別に引くが、病棟マップは 1 画面に 40〜60 人並ぶので、患者 id を
// カンマで OR にしてまとめて引く。参照パラメータのカンマ OR は PractitionerRole の
// organization= で使っている形と同じ。URL が長くなりすぎないよう患者を分割して並列に引く。

/**
 * 複数患者ぶんのリソースを患者 id ごとに振り分けて返す。buildParams は 1 塊ぶんの
 * 検索条件(患者以外)、subjectOf はリソースから患者 id を取る関数。
 */
async function fetchByPatientChunks<T extends fhir4.Resource>(
  resourceType: string,
  patientIds: string[],
  chunkSize: number,
  patientParam: string,
  buildParams: (params: URLSearchParams) => void,
  subjectOf: (resource: T) => string | undefined,
): Promise<Map<string, T[]>> {
  const result = new Map<string, T[]>();
  const chunks: string[][] = [];
  for (let i = 0; i < patientIds.length; i += chunkSize) chunks.push(patientIds.slice(i, i + chunkSize));

  const bundles = await Promise.all(
    chunks.map((ids) => {
      const params = new URLSearchParams();
      params.set(patientParam, ids.map((id) => `Patient/${id}`).join(","));
      params.set("_count", "500");
      buildParams(params);
      return searchResource<T>(resourceType, params);
    }),
  );
  for (const { data: bundle } of bundles) {
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (!resource || resource.resourceType !== resourceType) continue;
      const patientId = subjectOf(resource);
      if (!patientId) continue;
      const list = result.get(patientId);
      if (list) list.push(resource);
      else result.set(patientId, [resource]);
    }
  }
  return result;
}

/** 患者 id を並べ替えて queryKey にする(順序が違うだけで引き直さない)。 */
function patientIdsKey(patientIds: string[]): string {
  return [...new Set(patientIds)].sort().join(",");
}

const PATIENT_CHUNK = 50;
/** 検査結果は 1 人あたりの件数が多いので、塊を小さくして _count の上限に当たりにくくする。 */
const LAB_PATIENT_CHUNK = 5;

/** 複数患者の有効な注意(Flag)。患者 id → Flag[]。 */
export function useFlagsForPatients(patientIds: string[]) {
  const key = patientIdsKey(patientIds);
  const query = useQuery({
    queryKey: ["Flag", "search", "by-patients", key],
    queryFn: () =>
      fetchByPatientChunks<fhir4.Flag>(
        "Flag",
        key.split(","),
        PATIENT_CHUNK,
        "patient",
        (params) => params.set("status", "active"),
        (flag) => referenceId(flag.subject?.reference),
      ),
    enabled: key.length > 0,
    staleTime: 60 * 1000,
  });
  return { ...query, byPatient: query.data ?? new Map<string, fhir4.Flag[]>() };
}

/** 複数患者の活動中のアレルギー。患者 id → AllergyIntolerance[]。 */
export function useAllergiesForPatients(patientIds: string[]) {
  const key = patientIdsKey(patientIds);
  const query = useQuery({
    queryKey: ["AllergyIntolerance", "search", "by-patients", key],
    queryFn: () =>
      fetchByPatientChunks<fhir4.AllergyIntolerance>(
        "AllergyIntolerance",
        key.split(","),
        PATIENT_CHUNK,
        "patient",
        (params) => params.set("clinical-status", "active"),
        (allergy) => referenceId(allergy.patient?.reference),
      ),
    enabled: key.length > 0,
    staleTime: 60 * 1000,
  });
  return { ...query, byPatient: query.data ?? new Map<string, fhir4.AllergyIntolerance[]>() };
}

/**
 * 複数患者の感染症(手入力 + 検査由来)。患者 id → 陽性の行。
 * 検査由来は患者ごとに新しい順で上限までしか見ないので、古い陽性は落ちることがある
 * (患者帯と同じ INFECTION_LAB_COUNT の考え方を塊単位にしたもの)。
 */
export function useInfectionsForPatients(patientIds: string[]) {
  const key = patientIdsKey(patientIds);
  const manual = useQuery({
    queryKey: ["Observation", "search", "by-patients", "infection-manual", key],
    queryFn: () =>
      fetchByPatientChunks<fhir4.Observation>(
        "Observation",
        key.split(","),
        PATIENT_CHUNK,
        "subject",
        (params) => params.set("category", "exam"),
        (observation) => referenceId(observation.subject?.reference),
      ),
    enabled: key.length > 0,
    staleTime: 60 * 1000,
  });
  const lab = useQuery({
    queryKey: ["Observation", "search", "by-patients", "infection-lab", key],
    queryFn: () =>
      fetchByPatientChunks<fhir4.Observation>(
        "Observation",
        key.split(","),
        LAB_PATIENT_CHUNK,
        "subject",
        (params) => {
          params.set("category", "laboratory");
          params.set("_sort", "-date");
        },
        (observation) => referenceId(observation.subject?.reference),
      ),
    enabled: key.length > 0 && HAS_LAB_MAPPED_TYPES,
    staleTime: 60 * 1000,
  });

  const byPatient = useMemo(() => {
    const result = new Map<string, InfectionRow[]>();
    const ids = new Set([...(manual.data?.keys() ?? []), ...(lab.data?.keys() ?? [])]);
    for (const id of ids) {
      const rows = summarizeInfections(manual.data?.get(id) ?? [], lab.data?.get(id) ?? []).filter(
        (row) => row.result === "positive",
      );
      if (rows.length > 0) result.set(id, rows);
    }
    return result;
  }, [manual.data, lab.data]);

  return { byPatient, error: manual.error ?? lab.error, isPending: manual.isPending || lab.isPending };
}

export function useFlag(id: string | undefined) {
  return useQuery({
    queryKey: ["Flag", id],
    queryFn: () => readResource<fhir4.Flag>("Flag", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (flag: fhir4.Flag) => createResource(flag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Flag", "search"] });
    },
  });
}

// 削除は用意しない。誤登録も「終了」で残し、帯から消えれば運用上は足りる。
export function useUpdateFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ flag, etag }: { flag: fhir4.Flag; etag: string }) => updateResource(flag, etag),
    onSuccess: (result: FhirResult<fhir4.Flag>) => {
      queryClient.invalidateQueries({ queryKey: ["Flag", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Flag", result.data.id] });
    },
  });
}

// ---- 血液型(ABO / RhD の Observation) ----

/**
 * 患者の血液型。ABO と RhD を LOINC のコード 2 つで 1 回の検索にまとめる
 * (`code` はカンマ区切りで OR になる)。件数が少ないのでページングはしない。
 */
export function useBloodType(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("code", `http://loinc.org|883-9,http://loinc.org|10331-7`);
  params.set("_count", "20");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "blood-type"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });

  const observations =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Observation => Boolean(r)) ?? [];

  return { ...query, observations };
}

/**
 * 血液型の保存。ABO と RhD は別リソースなので transaction でまとめて送る
 * (片方だけ保存されて型が食い違う状態を作らないため)。
 */
export function useSaveBloodType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (observations: fhir4.Observation[]) => {
      const bundle: fhir4.Bundle = {
        resourceType: "Bundle",
        type: "transaction",
        entry: observations.map((observation) => ({
          resource: observation,
          request: observation.id
            ? { method: "PUT", url: `Observation/${observation.id}` }
            : { method: "POST", url: "Observation" },
        })),
      };
      return postBundle(bundle);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

// ---- 妊娠・授乳(Observation) ----

/**
 * 妊娠状態と授乳状態。血液型と同じく LOINC 2 つを 1 回の検索でまとめて引く。
 * 状態が変わる情報なので、確認日の新しいものを画面側で採る(summarizePregnancy)。
 */
export function usePregnancy(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("code", `http://loinc.org|82810-3,http://loinc.org|63895-7`);
  params.set("_count", "20");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "pregnancy"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });

  const observations =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Observation => Boolean(r)) ?? [];

  return { ...query, observations };
}

/** 妊娠・授乳の保存。血液型と同じく transaction でまとめて送る。 */
export function useSavePregnancy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (observations: fhir4.Observation[]) => {
      const bundle: fhir4.Bundle = {
        resourceType: "Bundle",
        type: "transaction",
        entry: observations.map((observation) => ({
          resource: observation,
          request: observation.id
            ? { method: "PUT", url: `Observation/${observation.id}` }
            : { method: "POST", url: "Observation" },
        })),
      };
      return postBundle(bundle);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

// ---- 感染症(Observation) ----

/**
 * 手入力の感染症。検体検査の結果と混ざらないよう category=exam で絞る
 * (検査結果は下の useLabInfectionResults が JLAC11 コードで引く)。
 */
export function useManualInfections(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", "exam");
  params.set("_count", "50");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "infection-manual"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });

  const observations =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Observation => Boolean(r)) ?? [];

  return { ...query, observations };
}

/** 感染症の判定に読む検体検査の結果の件数。新しい順にこの件数まで見る。 */
const INFECTION_LAB_COUNT = 500;

/**
 * 感染症の判定に使う検体検査の結果。
 *
 * 感染症かどうかは JLAC11 の分析物コード(先頭 5 桁)で決まるが、上流の
 * コード検索は完全一致なので前方一致で引けない。材料・測定法の違いを展開すると
 * 1 種類で数百コードになり URL に入らないため、患者の検体検査の結果を新しい順に
 * まとめて引き、分析物コードの突き合わせは画面側で行う(summarizeInfections)。
 */
export function useLabInfectionResults(patientId: string | undefined, enabled: boolean) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", "laboratory");
  params.set("_count", String(INFECTION_LAB_COUNT));
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "infection-lab"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId) && enabled,
    staleTime: 30 * 1000,
  });

  const observations =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Observation => Boolean(r)) ?? [];

  return { ...query, observations };
}

/** 手入力の感染症の保存。1 件ずつなので transaction は使わない。 */
export function useSaveInfection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ observation, etag }: { observation: fhir4.Observation; etag?: string }) =>
      observation.id && etag
        ? updateResource(observation, etag)
        : createResource(observation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

export function useDeleteInfection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Observation", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

// ---- 身体計測・腎機能(プロファイルの読み取り専用の区画) ----

/**
 * 身長・体重の最新値。バイタルの中からコードで絞って引く
 * (経過表のように全項目を読む必要がない)。
 */
export function useBodyMeasures(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("code", `http://loinc.org|8302-2,http://loinc.org|29463-7`);
  params.set("_count", "20");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "body-measure"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId),
    staleTime: 60 * 1000,
  });

  const observations =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Observation => Boolean(r)) ?? [];

  return { ...query, observations };
}

/**
 * 直近の検体検査の結果(新しい順)。分析物コード(先頭 5 桁)での突き合わせは画面側で
 * 行うので、ここでは患者の検査結果をまとめて引く。プロファイルの腎機能と、
 * 化学療法レジメンの投与前チェック(`regimenCheckHelpers.ts`)が同じ結果を読む。
 */
export function useRecentLabResults(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", "laboratory");
  params.set("_count", "200");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "lab-recent"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId),
    staleTime: 60 * 1000,
  });

  const observations =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Observation => Boolean(r)) ?? [];

  return { ...query, observations };
}

const QUESTIONNAIRE_COUNT = 20;

// canonical (url, version) の一意性は上流の Questionnaire バリデーション + DB 制約が
// 保証する(重複時は 422 / issue code: duplicate。和訳は fhir/outcome.ts)。
export function useQuestionnaireSearch(offset: number) {
  const params = new URLSearchParams();
  params.set("_count", String(QUESTIONNAIRE_COUNT));
  params.set("_offset", String(offset));
  // 更新日時の降順(新しい順)。
  params.set("_sort", "-_lastUpdated");

  const query = useQuery({
    queryKey: ["Questionnaire", "search", offset],
    queryFn: () => searchResource<fhir4.Questionnaire>("Questionnaire", params),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: QUESTIONNAIRE_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function useQuestionnaire(id: string | undefined) {
  return useQuery({
    queryKey: ["Questionnaire", id],
    queryFn: () => readResource<fhir4.Questionnaire>("Questionnaire", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      questionnaire,
      imageEntries,
    }: {
      questionnaire: fhir4.Questionnaire;
      imageEntries?: fhir4.BundleEntry[];
    }) => {
      return saveWithImages(questionnaire, imageEntries);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Questionnaire", "search"] });
    },
  });
}

export function useUpdateQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      questionnaire,
      etag,
      imageEntries,
    }: {
      questionnaire: fhir4.Questionnaire;
      etag: string;
      imageEntries?: fhir4.BundleEntry[];
    }) => {
      return saveWithImages(questionnaire, imageEntries, etag);
    },
    onSuccess: (result: FhirResult<fhir4.Questionnaire>) => {
      queryClient.invalidateQueries({ queryKey: ["Questionnaire", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Questionnaire", result.data.id] });
    },
  });
}

// テンプレートをシェーマ画像埋め込みの単一 JSON ファイルとしてダウンロードする。
// 帳票レイアウト(report_layouts)が登録済みなら .tlf とマッピング定義も同梱する。
// レイアウトの取得に失敗したらエクスポート自体を失敗にする(同梱されるはずの
// レイアウトが黙って欠けたファイルを作らない)。
export function useExportQuestionnaire() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await readResource<fhir4.Questionnaire>("Questionnaire", id);
      const exported = await buildQuestionnaireExport(data);

      const canonical = questionnaireCanonical(data);
      const [summary] = await fetchReportLayouts(canonical);
      const layout = summary ? await fetchReportLayout(summary.id) : undefined;
      downloadQuestionnaireExport(
        buildTransferExport(
          exported,
          layout && { name: layout.name, tlf: layout.tlf, mapping: layout.mapping },
        ),
      );
    },
  });
}

export interface ImportQuestionnaireResult {
  result: FhirResult<fhir4.Questionnaire>;
  /** 同梱レイアウトの登録結果(同梱なし・スキップ・失敗は "none")。 */
  layoutStatus: "created" | "updated" | "none";
  /** レイアウト登録の失敗理由(テンプレート本体は保存済み)。 */
  layoutError?: string;
  /** 同梱レイアウトが不正でスキップしたときの警告。 */
  layoutWarning?: string;
}

// エクスポートファイルを取り込んで新しいテンプレートとして保存する。
// 保存は新規作成と同じ経路(画像込み transaction Bundle。canonical 重複は上流が 422 で弾く)。
// 帳票レイアウトが同梱されていれば report_layouts へも登録する。
export function useImportQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<ImportQuestionnaireResult> => {
      const { values, reportLayout, layoutWarning } = parseTransferImport(await file.text());
      const { items, entries } = collectPendingImageEntries(values.items);
      const questionnaire = buildQuestionnaire({ ...values, items });
      const result = await saveWithImages(questionnaire, entries);
      if (!reportLayout) return { result, layoutStatus: "none", layoutWarning };

      // テンプレート本体(上流)が主、レイアウト(backend DB)は従。レイアウト側の
      // 失敗でインポート全体を失敗にせず、手動登録のフォールバックを案内する。
      // canonical の一意性は上流の保存(422/duplicate)が保証するので、保存が通った
      // 時点で同じ canonical のレイアウトは「上流にテンプレートが無い孤児レコード」
      // に限られる → 上書きする。
      try {
        const canonical = questionnaireCanonical(result.data);
        const [existing] = await fetchReportLayouts(canonical);
        const payload = {
          name: reportLayout.name,
          questionnaire_url: result.data.url ?? "",
          questionnaire_version: result.data.version ?? "",
          tlf: reportLayout.tlf,
          mapping: reportLayout.mapping,
        };
        if (existing) {
          await updateReportLayout(existing.id, payload);
          return { result, layoutStatus: "updated" };
        }
        await createReportLayout(payload);
        return { result, layoutStatus: "created" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { result, layoutStatus: "none", layoutError: message };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Questionnaire", "search"] });
    },
  });
}

export function useDeleteQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Questionnaire", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Questionnaire", "search"] });
    },
  });
}

// テンプレート選択用に Questionnaire をまとめて取得する。
// 上流 fhir-server の _count 上限 500 を上限とした簡易版(それ以上は運用上想定しない)。
export function useQuestionnaireOptions(options?: { status?: fhir4.Questionnaire["status"] }) {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  params.set("_count", "500");
  params.set("_sort", "-_lastUpdated");

  const query = useQuery({
    queryKey: ["Questionnaire", "search", "options", options?.status ?? ""],
    queryFn: () => searchResource<fhir4.Questionnaire>("Questionnaire", params),
  });

  return {
    ...query,
    questionnaires:
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Questionnaire => Boolean(r)) ?? [],
  };
}

// シェーマ画像(Binary)を dataURL で取得する。本アプリでは Binary は不変
// (差し替えは常に新規作成)なのでキャッシュを無期限に保持する。
export function useBinaryImage(binaryId: string | undefined) {
  return useQuery({
    queryKey: ["Binary", binaryId, "image"],
    queryFn: () => fetchBinaryImage(binaryId as string),
    enabled: Boolean(binaryId),
    staleTime: Infinity,
  });
}

// QuestionnaireResponse.questionnaire(canonical "<url>|<version>")から
// 元テンプレートを引き当てる。url は上流で完全一致検索される。
export function useQuestionnaireByCanonical(canonical: string | undefined) {
  const query = useQuery({
    queryKey: ["Questionnaire", "canonical", canonical],
    queryFn: async () => {
      const [url, version] = (canonical as string).split("|");
      const params = new URLSearchParams();
      params.set("url", url);
      if (version) params.set("version", version);
      const { data: bundle } = await searchResource<fhir4.Questionnaire>("Questionnaire", params);
      return bundle.entry?.map((e) => e.resource).find((r) => r) ?? null;
    },
    enabled: Boolean(canonical),
  });

  return { ...query, questionnaire: query.data ?? undefined };
}

export function useQuestionnaireResponse(id: string | undefined) {
  return useQuery({
    queryKey: ["QuestionnaireResponse", id],
    queryFn: () => readResource<fhir4.QuestionnaireResponse>("QuestionnaireResponse", id as string),
    enabled: Boolean(id),
  });
}

/**
 * 同じテンプレートに対する直近の回答。新規登録画面の「前回の回答を複写」に使う。
 *
 * canonical("<url>|<version>")の完全一致で引くので、テンプレートのバージョンを
 * 上げると前回の回答は見つからなくなる。設問が変わっていれば回答の対応も崩れる
 * ため、版をまたいで複写しないのは意図した動作。
 * クエリキーを ["QuestionnaireResponse", "search"] 配下に置き、登録・更新・削除の
 * invalidate がそのまま効くようにする。
 */
export function useLatestQuestionnaireResponse(
  patientId: string | undefined,
  canonical: string | undefined,
) {
  const query = useQuery({
    queryKey: ["QuestionnaireResponse", "search", "latest", patientId, canonical],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("questionnaire", canonical as string);
      params.set("_sort", "-authored");
      params.set("_count", "1");
      const { data: bundle } = await searchResource<fhir4.QuestionnaireResponse>(
        "QuestionnaireResponse",
        params,
      );
      return bundle.entry?.[0]?.resource;
    },
    enabled: Boolean(patientId && canonical),
  });

  return { ...query, latest: query.data };
}

// テンプレート表示用に QuestionnaireResponse と元テンプレートを 1 リクエストで取得する
// (canonical を解決する _include=QuestionnaireResponse:questionnaire)。
// 削除済みは read の 410 と違い空の Bundle になる(response が undefined のまま)。
// 編集画面は If-Match 用の ETag が要るため read(useQuestionnaireResponse)を使い続ける。
export function useQuestionnaireResponseWithQuestionnaire(id: string | undefined) {
  const query = useQuery({
    queryKey: ["QuestionnaireResponse", id, "withQuestionnaire"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("_id", id as string);
      params.set("_include", "QuestionnaireResponse:questionnaire");
      const { data: bundle } = await searchResource<fhir4.Resource>("QuestionnaireResponse", params);
      const resources = bundle.entry?.map((e) => e.resource) ?? [];
      return {
        response:
          resources.find(
            (r): r is fhir4.QuestionnaireResponse => r?.resourceType === "QuestionnaireResponse",
          ) ?? null,
        questionnaire:
          resources.find((r): r is fhir4.Questionnaire => r?.resourceType === "Questionnaire") ??
          null,
      };
    },
    enabled: Boolean(id),
  });

  return {
    ...query,
    response: query.data?.response ?? undefined,
    questionnaire: query.data?.questionnaire ?? undefined,
  };
}

// テンプレート回答フォームの初期値式(%conditions / %labResults / %prescriptions)の
// 元データ取得。傷病名はアクティブなもの全件(上流の _count 上限 500 まで)、
// 検査結果・処方は最新 1 件を _sort + _count + _include/_revinclude の 1 リクエスト
// で関連リソースごと取る(この組み合わせは上流の回帰 spec で保証済み)。
export function usePopulateSources(patientId: string | undefined) {
  const conditionParams = new URLSearchParams();
  if (patientId) conditionParams.set("patient", `Patient/${patientId}`);
  // 初期値式が対象にするのはアクティブな傷病名のみ(populateContext 参照)。
  conditionParams.set("clinical-status", "active");
  conditionParams.set("_count", "500");
  conditionParams.set("_sort", "-onset-date");
  const conditions = useQuery({
    queryKey: ["Condition", "populate", patientId],
    queryFn: () => searchResource<fhir4.Condition>("Condition", conditionParams),
    enabled: Boolean(patientId),
  });

  const labParams = new URLSearchParams();
  if (patientId) labParams.set("patient", `Patient/${patientId}`);
  labParams.set("category", "LAB");
  labParams.set("_count", "1");
  labParams.set("_sort", "-date");
  labParams.append("_include", "DiagnosticReport:result");
  labParams.append("_include", "DiagnosticReport:specimen");
  const labDetail = useQuery({
    queryKey: ["DiagnosticReport", "populate", patientId],
    queryFn: () => searchResource<fhir4.Resource>("DiagnosticReport", labParams),
    enabled: Boolean(patientId),
  });

  const rxParams = new URLSearchParams();
  if (patientId) rxParams.set("patient", `Patient/${patientId}`);
  // 処方だけが持つ処方区分の system で絞る(注射も同じ ServiceRequest として保存されるため)。
  rxParams.set("category", `${PRESCRIPTION_CATEGORY_SYSTEM}|`);
  rxParams.set("_count", "1");
  rxParams.set("_sort", "-authoredon");
  rxParams.set("_revinclude", "MedicationRequest:based-on");
  const rxDetail = useQuery({
    queryKey: ["ServiceRequest", "populate", patientId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", rxParams),
    enabled: Boolean(patientId),
  });

  const queries = [conditions, labDetail, rxDetail];

  return {
    isLoading: queries.some((q) => q.isPending),
    error: queries.find((q) => q.error)?.error ?? null,
    conditions: (conditions.data?.data.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is fhir4.Condition => r?.resourceType === "Condition"),
    labDetail: labDetail.data?.data,
    prescriptionDetail: rxDetail.data?.data,
  };
}

/**
 * これらの回答から生成した Observation の参照。回答を更新・削除するときに、前回の
 * 生成物を消すために引く(Observation.derivedFrom が唯一の根拠)。
 * 複数の回答はカンマ区切り(OR)の 1 検索でまとめて引く。1 回答あたりの項目数は
 * 多くても数十、1 記載あたりのテンプレート数も数個なので 1 ページで足りる。
 */
export async function fetchDerivedObservationRefs(responseIds: string[]): Promise<string[]> {
  const ids = responseIds.filter(Boolean);
  if (ids.length === 0) return [];
  const params = new URLSearchParams();
  params.set("derived-from", ids.map((id) => `QuestionnaireResponse/${id}`).join(","));
  params.set("_elements", "id");
  params.set("_count", "100");
  const { data } = await searchResource<fhir4.Observation>("Observation", params);
  return (data.entry ?? [])
    .map((entry) => entry.resource?.id)
    .filter((id): id is string => Boolean(id))
    .map((id) => `Observation/${id}`);
}

// 回答から Observation を生成するテンプレートは、回答・画像・Observation を 1 つの
// transaction で書く。生成しないテンプレートは単体リソースの保存経路のまま
// (無駄に Bundle にしない)。ただし抽出を後から無効にしたテンプレートでは、前回
// 生成した Observation を消すために Bundle 経路へ回る。
async function saveResponse(
  questionnaire: fhir4.Questionnaire,
  response: fhir4.QuestionnaireResponse,
  imageEntries?: fhir4.BundleEntry[],
  etag?: string,
): Promise<FhirResult<fhir4.QuestionnaireResponse>> {
  const extracts = observationExtractEnabled(questionnaire);
  const existingObservationRefs = response.id ? await fetchDerivedObservationRefs([response.id]) : [];
  if (!extracts && !existingObservationRefs.length) {
    return saveWithImages(response, imageEntries, etag);
  }

  const { data: bundle } = await postBundle(
    responseSaveBundle({ questionnaire, response, imageEntries, etag, existingObservationRefs }),
  );
  const saved = resourceFromBundleResponse<fhir4.QuestionnaireResponse>(bundle);
  if (!saved.resource) throw new Error("保存結果を取得できませんでした。");
  return { data: saved.resource, etag: saved.etag };
}

export function useCreateQuestionnaireResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      questionnaire,
      response,
      imageEntries,
    }: {
      questionnaire: fhir4.Questionnaire;
      response: fhir4.QuestionnaireResponse;
      imageEntries?: fhir4.BundleEntry[];
    }) => saveResponse(questionnaire, response, imageEntries),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

export function useUpdateQuestionnaireResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      questionnaire,
      response,
      etag,
      imageEntries,
    }: {
      questionnaire: fhir4.Questionnaire;
      response: fhir4.QuestionnaireResponse;
      etag: string;
      imageEntries?: fhir4.BundleEntry[];
    }) => saveResponse(questionnaire, response, imageEntries, etag),
    onSuccess: (result: FhirResult<fhir4.QuestionnaireResponse>) => {
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", result.data.id] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

export function useDeleteQuestionnaireResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    // 生成した Observation も一緒に消す(回答が消えると derivedFrom の指す先が
    // 無くなり、由来を辿れない Observation だけが残るため)。
    mutationFn: async (response: fhir4.QuestionnaireResponse) => {
      const id = response.id ?? "";
      const observationRefs = await fetchDerivedObservationRefs([id]);
      if (!observationRefs.length) return deleteResource("QuestionnaireResponse", id);
      await postBundle(responseDeleteBundle(id, observationRefs));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}
