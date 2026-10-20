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

// 生理検査オーダー項目。
export interface PhysioItem {
  id: number;
  item_code: string;
  name: string;
  short_name: string | null;
  name_kana: string | null;
  // single=単項目 / set=複数の検査をまとめて依頼するもの
  kind: string;
  // 他の検査項目と同じオーダーにまとめられるか。false は単独オーダー
  // (この項目だけで1オーダー。検査室の枠を1件ずつ押さえる項目)。
  groupable: boolean;
  /** 検査種別(master_physio_exam_types.exam_type_code)。未分類なら null。 */
  exam_type_code: string | null;
  valid_from: string | null;
  valid_to: string | null;
  receipt_code: string | null;
  display_order: number | null;
  note: string | null;
  // オーダー画面の「検査目的」「特別指示」を記入するテンプレート(Questionnaire)の
  // canonical。検査項目ごとの既定で、オーダー時に別のテンプレートも選べる。
  purpose_template_canonical: string | null;
  remarks_template_canonical: string | null;
  /** 所見レポートの所見を記入するテンプレートの既定(canonical)。 */
  report_findings_template_canonical: string | null;
  /**
   * 実施入力をする項目か。false の項目は生理検査一覧の「実施」で実施入力を
   * 開かずそのまま実施済にし、実施記録を作らない(カルテにも実施情報は出ない)。
   */
  requires_perform_input: boolean;
  /**
   * 実施入力の初期明細になるデータセット(master_physio_datasets)。1項目に1つで、
   * 同じデータセットを複数の検査項目から参照してよい。
   * requires_perform_input が false の項目は持たない。
   */
  dataset_code: string | null;
  /**
   * 予約必須の項目か。true の項目は検査室の枠(検査予約)を押さえてからオーダーする。
   * 予約ごとにオーダーが立つので必ず単独オーダー(groupable=false)。
   */
  requires_appointment: boolean;
  /** 所要時間(分)。予約で消費する枠数の計算に使う。未設定は 1 枠ぶん。 */
  duration_minutes: number | null;
  /**
   * 予約を取る先の枠表(FHIR Schedule の id)。予約必須の項目だけが持ち、
   * オーダー画面の予約モーダルでこの枠表が初期選択される。枠表が消えていたら
   * 通常の枠表選択にフォールバックする。
   */
  appointment_schedule_id: string | null;
  /** レセ電算コードから解決した医科診療行為の名称。一覧・詳細APIが添える。 */
  receipt_procedure_name?: string | null;
}

/** 検査種別コード → 名称。一覧・詳細APIが載っているコードの分だけ添えて返す。 */
export type PhysioExamTypeNames = Record<string, string>;

export interface PhysioItemSearchResult extends MasterSearchResult<PhysioItem> {
  exam_types: PhysioExamTypeNames;
}

// セットの構成。member_name 以降は一覧・詳細APIがオーダー項目から付与する。
export interface PhysioSetItem {
  id: number;
  set_item_code: string;
  member_item_code: string;
  display_order: number | null;
  note: string | null;
  member_name?: string | null;
  member_short_name?: string | null;
  /** 構成項目の検査種別。名称は詳細の exam_types で引く。 */
  member_exam_type_code?: string | null;
}

export interface PhysioItemDetail extends PhysioItem {
  exam_types: PhysioExamTypeNames;
  set_items: PhysioSetItem[];
  /** dataset_code から解決したデータセット名。未指定・削除済みなら null。 */
  dataset_name: string | null;
}

export interface PhysioItemPayload {
  item_code?: string;
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  kind?: string;
  groupable?: boolean;
  exam_type_code?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  receipt_code?: string | null;
  display_order?: number | null;
  note?: string | null;
  purpose_template_canonical?: string | null;
  remarks_template_canonical?: string | null;
  report_findings_template_canonical?: string | null;
  requires_perform_input?: boolean;
  dataset_code?: string | null;
  requires_appointment?: boolean;
  duration_minutes?: number | null;
  appointment_schedule_id?: string | null;
}

export interface PhysioSetItemPayload {
  set_item_code: string;
  member_item_code: string;
  display_order?: number | null;
  note?: string | null;
}

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
