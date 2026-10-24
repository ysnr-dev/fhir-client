import type {
  ExamItem,
  ExamItemDetail,
  ExamItemPayload,
  ExamItemSearchResult,
  ExamSetItem,
  ExamSetItemPayload,
  ExamTypeNames,
} from "./examItem";
import { buildError, masterFetch, type MasterSearchResult } from "./core";
import { performDatasetClient, type PerformDatasetDetail } from "./performDataset";
import { itemLayoutClient } from "./itemLayout";

// ---- 生理検査オーダーのマスタ ----
//
// 放射線検査と同じ構成だが、生理検査は JJ1017 に収載されていないので 32 桁コードと
// その要素を持たない。モダリティの位置には、施設が自由に定義する「検査種別」
// (master_physio_exam_types)が入る。

/** 検査種別(心電図・超音波検査 など)。放射線のモダリティに当たる分類軸。 */
export interface PhysioExamType {
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

export interface PhysioExamTypePayload {
  exam_type_code?: string;
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

// 生理検査オーダー項目。列は内視鏡と同じなので型は examItem.ts のものを使う。
export type PhysioItem = ExamItem;
export type PhysioExamTypeNames = ExamTypeNames;
export type PhysioItemSearchResult = ExamItemSearchResult;
export type PhysioSetItem = ExamSetItem;
export type PhysioItemDetail = ExamItemDetail;
export type PhysioItemPayload = ExamItemPayload;
export type PhysioSetItemPayload = ExamSetItemPayload;

const PHYSIO_EXAM_TYPES_PATH = "/master/physio_exam_types";

export async function searchPhysioExamTypes(params: {
  name?: string;
  /** 種別コード。カンマ区切りで複数指定できる。 */
  exam_type_code?: string;
  /** true なら今日使える種別(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<PhysioExamType>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.exam_type_code) search.set("exam_type_code", params.exam_type_code);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${PHYSIO_EXAM_TYPES_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<PhysioExamType>;
}

export async function createPhysioExamType(
  payload: PhysioExamTypePayload,
): Promise<PhysioExamType> {
  const res = await masterFetch(PHYSIO_EXAM_TYPES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PhysioExamType;
}

export async function updatePhysioExamType(
  id: number,
  payload: PhysioExamTypePayload,
): Promise<PhysioExamType> {
  const res = await masterFetch(`${PHYSIO_EXAM_TYPES_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PhysioExamType;
}

export async function deletePhysioExamType(id: number): Promise<void> {
  const res = await masterFetch(`${PHYSIO_EXAM_TYPES_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const PHYSIO_ITEMS_PATH = "/master/physio_items";

export async function searchPhysioItems(params: {
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
}): Promise<PhysioItemSearchResult> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.keyword) search.set("keyword", params.keyword);
  if (params.item_code) search.set("item_code", params.item_code);
  if (params.kind) search.set("kind", params.kind);
  if (params.groupable) search.set("groupable", params.groupable);
  if (params.exam_type_code) search.set("exam_type_code", params.exam_type_code);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${PHYSIO_ITEMS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PhysioItemSearchResult;
}

// 検査種別の名称とセット構成を添えた詳細。項目コードでも id でも引ける。
export async function fetchPhysioItem(idOrCode: string | number): Promise<PhysioItemDetail> {
  const res = await masterFetch(`${PHYSIO_ITEMS_PATH}/${encodeURIComponent(String(idOrCode))}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PhysioItemDetail;
}

export async function createPhysioItem(payload: PhysioItemPayload): Promise<PhysioItem> {
  const res = await masterFetch(PHYSIO_ITEMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PhysioItem;
}

export async function updatePhysioItem(id: number, payload: PhysioItemPayload): Promise<PhysioItem> {
  const res = await masterFetch(`${PHYSIO_ITEMS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PhysioItem;
}

export async function deletePhysioItem(id: number): Promise<void> {
  const res = await masterFetch(`${PHYSIO_ITEMS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function searchPhysioSetItems(params: {
  /** セットの項目コード。カンマ区切りで複数指定できる。 */
  set_item_code?: string;
  member_item_code?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<PhysioSetItem>> {
  const search = new URLSearchParams();
  if (params.set_item_code) search.set("set_item_code", params.set_item_code);
  if (params.member_item_code) search.set("member_item_code", params.member_item_code);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/physio_set_items?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<PhysioSetItem>;
}

export async function createPhysioSetItem(payload: PhysioSetItemPayload): Promise<PhysioSetItem> {
  const res = await masterFetch("/master/physio_set_items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PhysioSetItem;
}

export async function deletePhysioSetItem(id: number): Promise<void> {
  const res = await masterFetch(`/master/physio_set_items/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export const physioDatasetClient = performDatasetClient<PerformDatasetDetail>(
  "/master/physio_datasets",
  "/master/physio_dataset_details",
);

export const physioItemLayoutClient = itemLayoutClient(
  "item_code",
  "/master/physio_item_layouts",
  "/master/physio_item_layout_cells",
);
