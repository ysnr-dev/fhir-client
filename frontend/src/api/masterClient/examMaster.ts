import type {
  ExamItem,
  ExamItemDetail,
  ExamItemPayload,
  ExamItemSearchResult,
  ExamSetItem,
  ExamSetItemPayload,
} from "./examItem";
import { buildError, masterFetch, type MasterSearchResult } from "./core";
import { performDatasetClient, type PerformDatasetDetail } from "./performDataset";
import { itemLayoutClient } from "./itemLayout";

// ---- 検査種別を軸に持つ部門(生理検査・内視鏡)のオーダーマスタ ----
//
// 放射線検査と同じ構成だが、JJ1017 に収載されていないので 32 桁コードとその要素を持たない。
// モダリティの位置には、施設が自由に定義する「検査種別」(master_<部門>_exam_types)が入る。
// 検査種別の列は部門ごとに違いうる(内視鏡は JED 区分を持つ)ので、型は部門側から渡す。

/** 検査種別の共通の列。部門はこれを広げた型を渡す。 */
export interface ExamTypeBase {
  id: number;
  exam_type_code: string;
  name: string;
  short_name: string | null;
  name_kana: string | null;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
}

export interface ExamTypeSearchParams {
  name?: string;
  /** 種別コード。カンマ区切りで複数指定できる。 */
  exam_type_code?: string;
  /** true なら今日使える種別(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}

export interface ExamItemSearchParams {
  name?: string;
  /** 名称・検査種別のどちらかに当たる項目を1つの語で探す。 */
  keyword?: string;
  /** 項目コード。カンマ区切りで複数指定できる。 */
  item_code?: string;
  kind?: string;
  /** "true"=グループ化のみ / "false"=単独オーダーのみ。未指定なら両方。 */
  groupable?: string;
  exam_type_code?: string;
  /** true なら今日オーダーできる項目(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}

export interface ExamSetItemSearchParams {
  /** セットの項目コード。カンマ区切りで複数指定できる。 */
  set_item_code?: string;
  member_item_code?: string;
  page?: number;
  per?: number;
}

async function postJson<T>(path: string, method: "POST" | "PATCH", payload: unknown): Promise<T> {
  const res = await masterFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as T;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await masterFetch(path);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as T;
}

async function deleteOne(path: string): Promise<void> {
  const res = await masterFetch(path, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

// 空・未指定・false・0 のパラメータは送らない(URL に出る順は keys の順)。
function query<T extends object>(params: T, keys: (keyof T & string)[]): string {
  const search = new URLSearchParams();
  for (const key of keys) {
    const value = params[key] as string | number | boolean | undefined;
    if (!value) continue;
    search.set(key, value === true ? "true" : String(value));
  }
  return search.toString();
}

const EXAM_TYPE_KEYS: (keyof ExamTypeSearchParams)[] = ["name", "exam_type_code", "active", "page", "per"];
const ITEM_KEYS: (keyof ExamItemSearchParams)[] = [
  "name",
  "keyword",
  "item_code",
  "kind",
  "groupable",
  "exam_type_code",
  "active",
  "page",
  "per",
];
const SET_ITEM_KEYS: (keyof ExamSetItemSearchParams)[] = ["set_item_code", "member_item_code", "page", "per"];

/** 部門名(`physio` など)から、検査種別・項目・セット構成・データセット・伝票の API を組む。 */
export function examMasterClient<T extends ExamTypeBase, P>(dept: string) {
  const examTypesPath = `/master/${dept}_exam_types`;
  const itemsPath = `/master/${dept}_items`;
  const setItemsPath = `/master/${dept}_set_items`;

  return {
    searchExamTypes: (params: ExamTypeSearchParams) =>
      getJson<MasterSearchResult<T>>(`${examTypesPath}?${query(params, EXAM_TYPE_KEYS)}`),
    createExamType: (payload: P) => postJson<T>(examTypesPath, "POST", payload),
    updateExamType: (id: number, payload: P) => postJson<T>(`${examTypesPath}/${id}`, "PATCH", payload),
    deleteExamType: (id: number) => deleteOne(`${examTypesPath}/${id}`),

    searchItems: (params: ExamItemSearchParams) =>
      getJson<ExamItemSearchResult>(`${itemsPath}?${query(params, ITEM_KEYS)}`),
    // 検査種別の名称とセット構成を添えた詳細。項目コードでも id でも引ける。
    fetchItem: (idOrCode: string | number) =>
      getJson<ExamItemDetail>(`${itemsPath}/${encodeURIComponent(String(idOrCode))}`),
    createItem: (payload: ExamItemPayload) => postJson<ExamItem>(itemsPath, "POST", payload),
    updateItem: (id: number, payload: ExamItemPayload) =>
      postJson<ExamItem>(`${itemsPath}/${id}`, "PATCH", payload),
    deleteItem: (id: number) => deleteOne(`${itemsPath}/${id}`),

    searchSetItems: (params: ExamSetItemSearchParams) =>
      getJson<MasterSearchResult<ExamSetItem>>(`${setItemsPath}?${query(params, SET_ITEM_KEYS)}`),
    createSetItem: (payload: ExamSetItemPayload) => postJson<ExamSetItem>(setItemsPath, "POST", payload),
    deleteSetItem: (id: number) => deleteOne(`${setItemsPath}/${id}`),

    datasetClient: performDatasetClient<PerformDatasetDetail>(
      `/master/${dept}_datasets`,
      `/master/${dept}_dataset_details`,
    ),
    itemLayoutClient: itemLayoutClient(
      "item_code",
      `/master/${dept}_item_layouts`,
      `/master/${dept}_item_layout_cells`,
    ),
  };
}
