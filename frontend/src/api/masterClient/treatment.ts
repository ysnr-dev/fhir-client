import { buildError, masterFetch, type MasterSearchResult } from "./core";
import { performDatasetClient, type PerformDatasetDetail } from "./performDataset";
import { itemLayoutClient } from "./itemLayout";

// ---- 処置オーダーのマスタ ----
//
// 生理検査と同じ構成から、検査種別(分類軸)と検査目的・特別指示の既定テンプレートを
// 落としたもの。処置は項目名そのものが内容を表すので分類軸を持たず、オーダー画面にも
// 検査目的・特別指示の欄が無い。

// 処置オーダー項目。
export interface TreatmentItem {
  id: number;
  item_code: string;
  name: string;
  short_name: string | null;
  name_kana: string | null;
  // single=単項目 / set=複数の処置をまとめて依頼するもの
  kind: string;
  // 他の処置項目と同じオーダーにまとめられるか。false は単独オーダー
  // (この項目だけで1オーダー。処置室の枠を1件ずつ押さえる項目)。
  groupable: boolean;
  valid_from: string | null;
  valid_to: string | null;
  receipt_code: string | null;
  display_order: number | null;
  note: string | null;
  /**
   * 実施入力をする項目か。false の項目は処置一覧の「実施」で実施入力を
   * 開かずそのまま実施済にし、実施記録を作らない(カルテにも実施情報は出ない)。
   */
  requires_perform_input: boolean;
  /**
   * 実施入力の初期明細になるデータセット(master_treatment_datasets)。1項目に1つで、
   * 同じデータセットを複数の処置項目から参照してよい。
   * requires_perform_input が false の項目は持たない。
   */
  dataset_code: string | null;
  /**
   * 予約必須の項目か。true の項目は処置室の枠(処置予約)を押さえてからオーダーする。
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

// セットの構成。member_name 以降は一覧・詳細APIがオーダー項目から付与する。
export interface TreatmentSetItem {
  id: number;
  set_item_code: string;
  member_item_code: string;
  display_order: number | null;
  note: string | null;
  member_name?: string | null;
  member_short_name?: string | null;
}

export interface TreatmentItemDetail extends TreatmentItem {
  set_items: TreatmentSetItem[];
  /** dataset_code から解決したデータセット名。未指定・削除済みなら null。 */
  dataset_name: string | null;
}

export interface TreatmentItemPayload {
  item_code?: string;
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  kind?: string;
  groupable?: boolean;
  valid_from?: string | null;
  valid_to?: string | null;
  receipt_code?: string | null;
  display_order?: number | null;
  note?: string | null;
  requires_perform_input?: boolean;
  dataset_code?: string | null;
  requires_appointment?: boolean;
  duration_minutes?: number | null;
  appointment_schedule_id?: string | null;
}

export interface TreatmentSetItemPayload {
  set_item_code: string;
  member_item_code: string;
  display_order?: number | null;
  note?: string | null;
}

const TREATMENT_ITEMS_PATH = "/master/treatment_items";

export async function searchTreatmentItems(params: {
  name?: string;
  /** 名称・略称・カナを1つの語でまとめて探す(その場で項目を足す検索欄用)。 */
  keyword?: string;
  /** 項目コード。カンマ区切りで複数指定できる。 */
  item_code?: string;
  kind?: string;
  /** "true"=グループ化のみ / "false"=単独オーダーのみ。未指定なら両方。 */
  groupable?: string;
  /** true なら今日オーダーできる項目(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<TreatmentItem>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.keyword) search.set("keyword", params.keyword);
  if (params.item_code) search.set("item_code", params.item_code);
  if (params.kind) search.set("kind", params.kind);
  if (params.groupable) search.set("groupable", params.groupable);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${TREATMENT_ITEMS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<TreatmentItem>;
}

// セット構成を添えた詳細。項目コードでも id でも引ける。
export async function fetchTreatmentItem(idOrCode: string | number): Promise<TreatmentItemDetail> {
  const res = await masterFetch(`${TREATMENT_ITEMS_PATH}/${encodeURIComponent(String(idOrCode))}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as TreatmentItemDetail;
}

export async function createTreatmentItem(payload: TreatmentItemPayload): Promise<TreatmentItem> {
  const res = await masterFetch(TREATMENT_ITEMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as TreatmentItem;
}

export async function updateTreatmentItem(id: number, payload: TreatmentItemPayload): Promise<TreatmentItem> {
  const res = await masterFetch(`${TREATMENT_ITEMS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as TreatmentItem;
}

export async function deleteTreatmentItem(id: number): Promise<void> {
  const res = await masterFetch(`${TREATMENT_ITEMS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function searchTreatmentSetItems(params: {
  /** セットの項目コード。カンマ区切りで複数指定できる。 */
  set_item_code?: string;
  member_item_code?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<TreatmentSetItem>> {
  const search = new URLSearchParams();
  if (params.set_item_code) search.set("set_item_code", params.set_item_code);
  if (params.member_item_code) search.set("member_item_code", params.member_item_code);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/treatment_set_items?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<TreatmentSetItem>;
}

export async function createTreatmentSetItem(payload: TreatmentSetItemPayload): Promise<TreatmentSetItem> {
  const res = await masterFetch("/master/treatment_set_items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as TreatmentSetItem;
}

export async function deleteTreatmentSetItem(id: number): Promise<void> {
  const res = await masterFetch(`/master/treatment_set_items/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export const treatmentDatasetClient = performDatasetClient<PerformDatasetDetail>(
  "/master/treatment_datasets",
  "/master/treatment_dataset_details",
);

export const treatmentItemLayoutClient = itemLayoutClient(
  "item_code",
  "/master/treatment_item_layouts",
  "/master/treatment_item_layout_cells",
);
