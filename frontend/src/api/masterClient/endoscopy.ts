import type {
  ExamItem,
  ExamItemDetail,
  ExamItemPayload,
  ExamItemSearchResult,
  ExamSetItem,
  ExamSetItemPayload,
  ExamTypeNames,
} from "./examItem";
import {
  buildError,
  masterFetch,
  type MasterImportResult,
  type MasterSearchResult,
  type MasterType,
} from "./core";
import { performDatasetClient, type PerformDatasetDetail } from "./performDataset";
import { itemLayoutClient } from "./itemLayout";

// ---- 内視鏡オーダーのマスタ ----
//
// 生理検査と同じ構成。モダリティの位置には施設が自由に定義する「検査種別」
// (master_endoscopy_exam_types)が入り、検査種別は JED(Japan Endoscopy Database)の
// 4区分(上部・小腸・下部・ERCP)との対応(jed_exam_category)を持てる。JED の
// 用語そのものはマスタに持たず、Questionnaire テンプレートの選択肢に転記する。

/** JED の検査種別4区分。JED 対象外の種別(気管支鏡 など)は null。 */
export type JedExamCategory = "upper_gi" | "small_intestine" | "lower_gi" | "ercp";

/** 検査種別(上部消化管内視鏡・下部消化管内視鏡 など)。モダリティに当たる分類軸。 */
export interface EndoscopyExamType {
  id: number;
  exam_type_code: string;
  name: string;
  short_name: string | null;
  name_kana: string | null;
  jed_exam_category: JedExamCategory | null;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
}

export interface EndoscopyExamTypePayload {
  exam_type_code?: string;
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  jed_exam_category?: JedExamCategory | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

// 内視鏡オーダー項目。列は生理検査と同じなので型は examItem.ts のものを使う。
export type EndoscopyItem = ExamItem;
export type EndoscopyExamTypeNames = ExamTypeNames;
export type EndoscopyItemSearchResult = ExamItemSearchResult;
export type EndoscopySetItem = ExamSetItem;
export type EndoscopyItemDetail = ExamItemDetail;
export type EndoscopyItemPayload = ExamItemPayload;
export type EndoscopySetItemPayload = ExamSetItemPayload;

const ENDOSCOPY_EXAM_TYPES_PATH = "/master/endoscopy_exam_types";

export async function searchEndoscopyExamTypes(params: {
  name?: string;
  /** 種別コード。カンマ区切りで複数指定できる。 */
  exam_type_code?: string;
  /** true なら今日使える種別(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<EndoscopyExamType>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.exam_type_code) search.set("exam_type_code", params.exam_type_code);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${ENDOSCOPY_EXAM_TYPES_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<EndoscopyExamType>;
}

export async function createEndoscopyExamType(
  payload: EndoscopyExamTypePayload,
): Promise<EndoscopyExamType> {
  const res = await masterFetch(ENDOSCOPY_EXAM_TYPES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyExamType;
}

export async function updateEndoscopyExamType(
  id: number,
  payload: EndoscopyExamTypePayload,
): Promise<EndoscopyExamType> {
  const res = await masterFetch(`${ENDOSCOPY_EXAM_TYPES_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyExamType;
}

export async function deleteEndoscopyExamType(id: number): Promise<void> {
  const res = await masterFetch(`${ENDOSCOPY_EXAM_TYPES_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const ENDOSCOPY_ITEMS_PATH = "/master/endoscopy_items";

export async function searchEndoscopyItems(params: {
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
}): Promise<EndoscopyItemSearchResult> {
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

  const res = await masterFetch(`${ENDOSCOPY_ITEMS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyItemSearchResult;
}

// 検査種別の名称とセット構成を添えた詳細。項目コードでも id でも引ける。
export async function fetchEndoscopyItem(idOrCode: string | number): Promise<EndoscopyItemDetail> {
  const res = await masterFetch(`${ENDOSCOPY_ITEMS_PATH}/${encodeURIComponent(String(idOrCode))}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyItemDetail;
}

export async function createEndoscopyItem(payload: EndoscopyItemPayload): Promise<EndoscopyItem> {
  const res = await masterFetch(ENDOSCOPY_ITEMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyItem;
}

export async function updateEndoscopyItem(id: number, payload: EndoscopyItemPayload): Promise<EndoscopyItem> {
  const res = await masterFetch(`${ENDOSCOPY_ITEMS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyItem;
}

export async function deleteEndoscopyItem(id: number): Promise<void> {
  const res = await masterFetch(`${ENDOSCOPY_ITEMS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function searchEndoscopySetItems(params: {
  /** セットの項目コード。カンマ区切りで複数指定できる。 */
  set_item_code?: string;
  member_item_code?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<EndoscopySetItem>> {
  const search = new URLSearchParams();
  if (params.set_item_code) search.set("set_item_code", params.set_item_code);
  if (params.member_item_code) search.set("member_item_code", params.member_item_code);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/endoscopy_set_items?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<EndoscopySetItem>;
}

export async function createEndoscopySetItem(payload: EndoscopySetItemPayload): Promise<EndoscopySetItem> {
  const res = await masterFetch("/master/endoscopy_set_items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopySetItem;
}

export async function deleteEndoscopySetItem(id: number): Promise<void> {
  const res = await masterFetch(`/master/endoscopy_set_items/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export const endoscopyDatasetClient = performDatasetClient<PerformDatasetDetail>(
  "/master/endoscopy_datasets",
  "/master/endoscopy_dataset_details",
);

export const endoscopyItemLayoutClient = itemLayoutClient(
  "item_code",
  "/master/endoscopy_item_layouts",
  "/master/endoscopy_item_layout_cells",
);

export async function importMaster(
  masterType: MasterType,
  file: File,
): Promise<MasterImportResult> {
  const formData = new FormData();
  formData.append("file", file);

  // Content-Type は指定しない（ブラウザが multipart boundary 付きで設定する）
  const res = await masterFetch(`/master/${masterType}/import`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterImportResult;
}
