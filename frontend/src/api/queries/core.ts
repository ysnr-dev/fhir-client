import { useQuery } from "@tanstack/react-query";
import { resourceFromBundleResponse, resourceWithImagesBundle } from "../../fhir/schemaImage";
import {
  createResource,
  type FhirResult,
  postBundle,
  searchResource,
  typeOperation,
  updateResource,
} from "../fhirClient";

/**
 * 内服の予定を出すのに遡る日数。処方の投与日数には上限が無いが、上流は投与日数を
 * 索引しないので「これより前に始まった処方は引かない」線を引く必要がある。
 */
export const ORAL_LOOKBACK_DAYS = 92;

// シェーマ画像を伴う保存は、画像 Binary と本体を 1 つの transaction Bundle で
// atomic に書く(片方だけ保存されて孤児 Binary が残ることを防ぐ)。画像がない
// 保存は単体リソースの POST / PUT。戻り値は両者で同じ形に揃える。
export async function saveWithImages<T extends fhir4.Resource & { id?: string }>(
  resource: T,
  imageEntries: fhir4.BundleEntry[] | undefined,
  etag?: string,
): Promise<FhirResult<T>> {
  if (!imageEntries?.length) {
    return etag ? updateResource(resource, etag) : createResource(resource);
  }

  const { data: bundle } = await postBundle(resourceWithImagesBundle(resource, imageEntries, etag));
  const saved = resourceFromBundleResponse<T>(bundle);
  if (!saved.resource) throw new Error("保存結果を取得できませんでした。");
  return { data: saved.resource, etag: saved.etag };
}

/**
 * オーダー 1 件の詳細を引く hook を作る。ヘッダを `_id` で引き、明細(基づく先を持つ
 * ServiceRequest)や進捗・実施記録は `_revinclude` で同じ応答に添えてもらう。
 * queryKey の種別名は書き込み側の invalidate と対応させる。
 */
export function makeOrderDetailHook<T extends fhir4.Resource = fhir4.ServiceRequest>(
  kind: string,
  revincludes: { iterate?: string[]; direct?: string[] },
) {
  return function useOrderDetail(srId: string | undefined) {
    const params = new URLSearchParams();
    if (srId) params.set("_id", srId);
    for (const target of revincludes.iterate ?? []) params.append("_revinclude:iterate", target);
    for (const target of revincludes.direct ?? []) params.append("_revinclude", target);

    return useQuery({
      queryKey: ["ServiceRequest", "detail", kind, srId],
      queryFn: () => searchResource<T>("ServiceRequest", params),
      enabled: Boolean(srId),
    });
  };
}

/** ヘッダと明細(パネルの構成項目まで 2 段)を 1 リクエストで受け取る。 */
export const ORDER_ITEM_REVINCLUDES = { iterate: ["ServiceRequest:based-on"] };
/** 明細を持たないヘッダに、進捗と実施記録を添える。 */
export const ORDER_PERFORM_REVINCLUDES = { direct: ["Task:focus", "Procedure:based-on"] };

// ---- 部門ワークリスト共通 ----
//
// 放射線・検体検査・処方の一覧は、1 日ぶんのオーダー(ヘッダ)を _offset で
// ページングしながら全件読み、患者(_include)と進捗(Task の _revinclude)を
// 同じ応答から回収する、という骨格が共通。ドメインごとの明細の回収と行の
// 組み立てはコールバックで注入する。

export const WORKLIST_PAGE = 500;

// ---- $distinct-dates(サーバー集計) ----

/** 実行環境のタイムゾーンオフセット("+09:00" 形式)。$distinct-dates の日境界に使う。 */
function localTimezoneOffset(): string {
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

interface DistinctDatesResult {
  /** 新しい順。precision=day なら "2026-08-23"、full なら UTC の dateTime。 */
  dates: string[];
  /** 対象パラメータの値を持たないリソースが 1 件でもあるか。 */
  hasUndated: boolean;
}

/**
 * GET /<型>/$distinct-dates。ある date 検索パラメータが取る値の重複なし集合を
 * サーバー集計で取得する(上流の独自 operation)。「診療日の一覧」「直近 N 回分の
 * 採取日」を作るのに使う。
 */
export async function fetchDistinctDates(
  resourceType: string,
  params: URLSearchParams,
  dateParam: string,
  options: { precision?: "day" | "full"; limit?: number } = {},
): Promise<DistinctDatesResult> {
  params.set("date-param", dateParam);
  // day(既定)はローカルの日付に丸める。full は dateTime の実値(経過表の列)。
  if (options.precision === "full") params.set("precision", "full");
  else params.set("timezone", localTimezoneOffset());
  if (options.limit) params.set("limit", String(options.limit));

  const { data } = await typeOperation<fhir4.Parameters>(resourceType, "distinct-dates", params);
  const dates: string[] = [];
  let hasUndated = false;
  for (const parameter of data.parameter ?? []) {
    if (parameter.name === "date") {
      const value = parameter.valueDate ?? parameter.valueDateTime;
      if (value) dates.push(value);
    } else if (parameter.name === "undated") {
      hasUndated = Boolean(parameter.valueBoolean);
    }
  }
  return { dates, hasUndated };
}

/**
 * 同じ operation の件数モード(count=true)。日付 -> 件数の Map を返す。
 * 応答は Parameters の不変条件(value と part は排他)により part 形式になる。
 */
export async function fetchDateCounts(
  resourceType: string,
  params: URLSearchParams,
  dateParam: string,
): Promise<Map<string, number>> {
  params.set("date-param", dateParam);
  params.set("timezone", localTimezoneOffset());
  params.set("count", "true");

  const { data } = await typeOperation<fhir4.Parameters>(resourceType, "distinct-dates", params);
  const counts = new Map<string, number>();
  for (const parameter of data.parameter ?? []) {
    if (parameter.name !== "date") continue;
    const date = parameter.part?.find((p) => p.name === "value")?.valueDate;
    const count = parameter.part?.find((p) => p.name === "count")?.valueInteger;
    if (date && count !== undefined) counts.set(date, count);
  }
  return counts;
}

/** 通知(Task)の queryKey。通知一覧と、通知を書き込む各機能の読み直しで共有する。 */
export const NOTIFICATION_TASK_KEY = ["Task", "notification"];

// 版履歴の取得件数。1 つの記録がこれを超えて修正されることは想定していない。
export const HISTORY_COUNT = 50;

/**
 * 期間継続型のオーダー(食事・リハビリ・栄養指導・看護指示)を「from〜to の期間に
 * 掛かっているもの」に絞る。開始は occurrenceDateTime、終了は各種別の *-order-end
 * 拡張を上流が order-period として索引している。終了の無いオーダーは継続中として掛かる。
 * from と to に同じ日を渡すと「その日に効いている」になる。
 */
export function setOrderPeriod(params: URLSearchParams, from: string, to: string): void {
  params.append("order-period", `ge${from}`);
  params.append("order-period", `le${to}`);
}

export function resourcesOfType<T extends fhir4.Resource>(bundle: fhir4.Bundle, type: T["resourceType"]): T[] {
  return (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is T => r?.resourceType === type);
}

interface PagedSearch<T extends fhir4.Resource> {
  /** 検索対象の型のリソース(ページ順)。 */
  matches: T[];
  /** 読んだページの Bundle。_include / _revinclude で添えられたリソースはこちらから拾う。 */
  bundles: fhir4.Bundle[];
  /** maxPages まで読んでも 1 ページぶん埋まっていた(続きがあるかもしれない)。 */
  truncated: boolean;
}

/**
 * `_count` を 1 ページとして `_offset` で順に辿る。検索に一致した行(search.mode が include で
 * ないもの)が 1 ページに満たなければ終わり。_include / _revinclude の行は上流が `_count` に
 * 数えないので、entry の総数では判定しない(同じ型を _revinclude:iterate で添える検索もある)。
 */
export async function searchAllPages<T extends fhir4.Resource>(
  type: T["resourceType"],
  params: URLSearchParams,
  options: { page: number; maxPages: number },
): Promise<PagedSearch<T>> {
  const matches: T[] = [];
  const bundles: fhir4.Bundle[] = [];
  for (let page = 0; page < options.maxPages; page += 1) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("_count", String(options.page));
    pageParams.set("_offset", String(page * options.page));
    const { data: bundle } = await searchResource<fhir4.Resource>(type, pageParams);
    const found = (bundle.entry ?? [])
      .filter((entry) => entry.search?.mode !== "include")
      .map((entry) => entry.resource)
      .filter((r): r is T => r?.resourceType === type);
    matches.push(...found);
    bundles.push(bundle);
    if (found.length < options.page) return { matches, bundles, truncated: false };
  }
  return { matches, bundles, truncated: true };
}
