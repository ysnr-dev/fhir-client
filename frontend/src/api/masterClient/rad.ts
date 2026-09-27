import { buildError, masterFetch, type MasterSearchResult } from "./core";

// 放射線検査オーダーのマスタ群 ----------------------------------------------

// JJ1017 の部品コード(手技・部位・体位・撮影方向など)。element でどの別表の
// コードかを区別する。source=official は配布ファイル由来、local は施設拡張。
export interface RadJj1017Code {
  id: number;
  element: string;
  code: string;
  name: string;
  name_english: string | null;
  // 別表1D(手技拡張)の核医学領域頻用名(11C-CH3COOH → 11C-酢酸)
  common_name: string | null;
  jj_version: string | null;
  note: string | null;
  // official | local
  source: string;
  display_order: number | null;
  // 以下は element="body_part" のときだけ入る。
  major_part_code: string | null;
  organ_system_code: string | null;
  use_general: boolean;
  use_ct: boolean;
  use_mr: boolean;
  use_us: boolean;
}

export interface RadJj1017CodePayload {
  element?: string;
  code?: string;
  name?: string;
  name_english?: string | null;
  common_name?: string | null;
  note?: string | null;
}

// 要素の定義。32桁コード内の位置(offset/length)もサーバーが持つ値をそのまま使い、
// 画面側で桁の割り当てを持たない。
export interface RadJj1017Element {
  element: string;
  label: string;
  table: string;
  offset: number;
  length: number;
  extension_allowed: boolean;
  extension_label: string | null;
  official_count: number;
  local_count: number;
}

export interface RadJj1017Elements {
  code_length: number;
  generic_extension: { offset: number; length: number };
  elements: RadJj1017Element[];
}

// JJ1017 の代表的頻用コード集(別表F)。オーダー項目の初期データの種。
export interface RadFrequentCode {
  id: number;
  // rad_exam | ultrasound | radiotherapy
  category: string;
  jj1017_code: string;
  name: string;
  display_order: number | null;
}

// 放射線オーダー項目。JJ1017 の各要素をコードで持ち、32桁コードは保存時に
// サーバーが要素から組み立てる。
export interface RadItem {
  id: number;
  item_code: string;
  name: string;
  short_name: string | null;
  name_kana: string | null;
  // single=単項目 / set=複数の撮影をまとめて依頼するもの
  kind: string;
  // 他の撮影項目と同じオーダーにまとめられるか。false は単独オーダー
  // (この項目だけで1オーダー。CT・MRI など1撮影に時間を要する項目)。
  groupable: boolean;
  modality_code: string | null;
  procedure_major_code: string | null;
  procedure_minor_code: string | null;
  procedure_extension_code: string | null;
  body_part_code: string | null;
  laterality_code: string | null;
  body_position_code: string | null;
  direction_code: string | null;
  detail_position_code: string | null;
  special_instruction_code: string | null;
  nuclide_code: string | null;
  // 15〜16桁目の拡張(汎用)。部品コード表を持たない共通拡張領域。
  generic_extension_code: string | null;
  jj1017_code: string | null;
  valid_from: string | null;
  valid_to: string | null;
  receipt_code: string | null;
  /** 撮影部位の選択式コメント(820 系)。医事会計へ送るときに撮影に添える。 */
  site_comment_code: string | null;
  display_order: number | null;
  note: string | null;
  // オーダー画面の「検査目的」「特別指示」を記入するテンプレート(Questionnaire)の
  // canonical。撮影項目ごとの既定で、オーダー時に別のテンプレートも選べる。
  purpose_template_canonical: string | null;
  remarks_template_canonical: string | null;
  /** 読影レポートの所見を記入するテンプレートの既定(canonical)。 */
  report_findings_template_canonical: string | null;
  /**
   * 実施入力をする項目か。false の項目は放射線検査一覧の「実施」で実施入力を
   * 開かずそのまま実施済にし、実施記録を作らない(カルテにも実施情報は出ない)。
   */
  requires_perform_input: boolean;
  /**
   * 実施入力の初期明細になるデータセット(master_rad_datasets)。1項目に1つで、
   * 同じデータセットを複数の撮影項目から参照してよい。
   * requires_perform_input が false の項目は持たない。
   */
  dataset_code: string | null;
  /**
   * 予約必須の項目か。true の項目は撮影室の枠(検査予約)を押さえてからオーダーする。
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
}

// 要素コード → 名称。一覧・詳細APIが載っているコードの分だけ添えて返す。
export type RadElementNames = Record<string, Record<string, string>>;

export interface RadItemSearchResult extends MasterSearchResult<RadItem> {
  elements: RadElementNames;
}

// セットの構成。member_name 以降は詳細APIがオーダー項目から付与する。
export interface RadSetItem {
  id: number;
  set_item_code: string;
  member_item_code: string;
  display_order: number | null;
  note: string | null;
  member_name?: string | null;
  member_short_name?: string | null;
  member_jj1017_code?: string | null;
  // 構成項目の種別(モダリティ)・部位。名称は詳細の elements で引く。
  member_modality_code?: string | null;
  member_body_part_code?: string | null;
}

export interface RadItemDetail extends RadItem {
  elements: RadElementNames;
  set_items: RadSetItem[];
  /** dataset_code から解決したデータセット名。未指定・削除済みなら null。 */
  dataset_name: string | null;
}

export interface RadItemPayload {
  item_code?: string;
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  kind?: string;
  groupable?: boolean;
  modality_code?: string | null;
  procedure_major_code?: string | null;
  procedure_minor_code?: string | null;
  procedure_extension_code?: string | null;
  body_part_code?: string | null;
  laterality_code?: string | null;
  body_position_code?: string | null;
  direction_code?: string | null;
  detail_position_code?: string | null;
  special_instruction_code?: string | null;
  nuclide_code?: string | null;
  generic_extension_code?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  receipt_code?: string | null;
  site_comment_code?: string | null;
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

export interface RadSetItemPayload {
  set_item_code: string;
  member_item_code: string;
  display_order?: number | null;
  note?: string | null;
}

// 頻用コードからの一括作成の結果。作らなかったもの(登録済み)と、
// 作れなかったもの(検証エラー)を分けて返す。
export interface RadBulkCreateResult {
  created: number;
  skipped: { jj1017_code: string; name: string }[];
  errors: { jj1017_code: string; name: string; messages: string[] }[];
  items: RadItem[];
}

// 放射線オーダーレイアウト(伝票のようなグリッド)。1マスの中身は
// RadItemLayoutCell が持つ。
export interface RadItemLayout {
  id: number;
  name: string;
  row_count: number;
  column_count: number;
  display_order: number | null;
  active: boolean;
  note: string | null;
}

export interface RadItemLayoutCell {
  id: number;
  layout_id: number;
  grid_row: number;
  grid_column: number;
  // item=放射線オーダー項目 / label=表示専用の文言
  cell_type: string;
  item_code: string | null;
  // item: 伝票上の表示名(空ならオーダー項目名) / label: 表示文言
  display_name: string | null;
  item_name?: string | null;
  item_short_name?: string | null;
  item_kind?: string | null;
}

export interface RadItemLayoutDetail extends RadItemLayout {
  cells: RadItemLayoutCell[];
  // 行数・列数を縮めたとき、範囲外で片付けられたセルの数(update の応答のみ)。
  removed_cells?: number;
}

export interface RadItemLayoutPayload {
  name?: string;
  row_count?: number;
  column_count?: number;
  display_order?: number | null;
  active?: boolean;
  note?: string | null;
}

export interface RadItemLayoutCellPayload {
  layout_id: number;
  grid_row: number;
  grid_column: number;
  cell_type?: string;
  item_code?: string | null;
  display_name?: string | null;
}

const RAD_JJ1017_CODES_PATH = "/master/rad_jj1017_codes";

export async function searchRadJj1017Codes(params: {
  element?: string;
  /** コード。カンマ区切りで複数指定できる。 */
  code?: string;
  /** official | local */
  source?: string;
  /** 部位の候補を撮影種別で絞る(general | ct | mr | us)。 */
  modality_use?: string;
  name?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<RadJj1017Code>> {
  const search = new URLSearchParams();
  if (params.element) search.set("element", params.element);
  if (params.code) search.set("code", params.code);
  if (params.source) search.set("source", params.source);
  if (params.modality_use) search.set("modality_use", params.modality_use);
  if (params.name) search.set("name", params.name);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${RAD_JJ1017_CODES_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<RadJj1017Code>;
}

export async function fetchRadJj1017Elements(): Promise<RadJj1017Elements> {
  const res = await masterFetch(`${RAD_JJ1017_CODES_PATH}/elements`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadJj1017Elements;
}

// 全要素のコードを要素名でまとめたもの。オーダー項目の編集画面が11要素すべての
// 選択肢を一度に組み立てるために使う。
export type RadJj1017Catalog = Record<string, RadJj1017Code[]>;

export async function fetchRadJj1017Catalog(): Promise<RadJj1017Catalog> {
  const res = await masterFetch(`${RAD_JJ1017_CODES_PATH}/catalog`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadJj1017Catalog;
}

export async function createRadJj1017Code(payload: RadJj1017CodePayload): Promise<RadJj1017Code> {
  const res = await masterFetch(RAD_JJ1017_CODES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadJj1017Code;
}

export async function updateRadJj1017Code(
  id: number,
  payload: RadJj1017CodePayload,
): Promise<RadJj1017Code> {
  const res = await masterFetch(`${RAD_JJ1017_CODES_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadJj1017Code;
}

export async function deleteRadJj1017Code(id: number): Promise<void> {
  const res = await masterFetch(`${RAD_JJ1017_CODES_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function searchRadFrequentCodes(params: {
  category?: string;
  /** 32桁コードの先頭1桁。カンマ区切りで複数指定できる。 */
  modality_code?: string;
  /** 32桁コードの8〜10桁目。カンマ区切りで複数指定できる。 */
  body_part_code?: string;
  /** true ならオーダー項目として未登録のものだけ。 */
  unregistered?: boolean;
  name?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<RadFrequentCode>> {
  const search = new URLSearchParams();
  if (params.category) search.set("category", params.category);
  if (params.modality_code) search.set("modality_code", params.modality_code);
  if (params.body_part_code) search.set("body_part_code", params.body_part_code);
  if (params.unregistered) search.set("unregistered", "true");
  if (params.name) search.set("name", params.name);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/rad_frequent_codes?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<RadFrequentCode>;
}

// 放射線検査で使う器材の施設マスタ。レセプト電算の特定器材は概念的な区分で
// 収載されているため、実際に購入している製品をここに登録し、算定に使う特定器材
// コードを紐付ける。
export interface RadMaterial {
  id: number;
  /** 施設内の器材コード。 */
  material_code: string;
  /** 製品名(実際に購入しているもの)。 */
  name: string;
  name_kana: string | null;
  maker: string | null;
  model_number: string | null;
  /** 算定に使うレセプト電算の特定器材コード。未紐付けなら空。 */
  receipt_material_code: string | null;
  unit_name: string | null;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
  /** 紐付け先の名称・価格。一覧・詳細 API が添えて返す(未紐付け・未取込なら null)。 */
  receipt_material_name: string | null;
  receipt_material_price: string | null;
}

export interface RadMaterialPayload {
  material_code?: string;
  name?: string;
  name_kana?: string | null;
  maker?: string | null;
  model_number?: string | null;
  receipt_material_code?: string | null;
  unit_name?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

const RAD_MATERIALS_PATH = "/master/rad_materials";

export async function searchRadMaterials(params: {
  name?: string;
  maker?: string;
  /** 施設内の器材コード。カンマ区切りで複数指定できる。 */
  material_code?: string;
  receipt_material_code?: string;
  /** true なら紐付けのないものだけ(算定できない器材の点検用)。 */
  unlinked?: boolean;
  /** true なら今日採用している器材(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<RadMaterial>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.maker) search.set("maker", params.maker);
  if (params.material_code) search.set("material_code", params.material_code);
  if (params.receipt_material_code) search.set("receipt_material_code", params.receipt_material_code);
  if (params.unlinked) search.set("unlinked", "true");
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${RAD_MATERIALS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<RadMaterial>;
}

export async function fetchRadMaterial(idOrCode: string | number): Promise<RadMaterial> {
  const res = await masterFetch(`${RAD_MATERIALS_PATH}/${encodeURIComponent(String(idOrCode))}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadMaterial;
}

export async function createRadMaterial(payload: RadMaterialPayload): Promise<RadMaterial> {
  const res = await masterFetch(RAD_MATERIALS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadMaterial;
}

export async function updateRadMaterial(
  id: number,
  payload: RadMaterialPayload,
): Promise<RadMaterial> {
  const res = await masterFetch(`${RAD_MATERIALS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadMaterial;
}

export async function deleteRadMaterial(id: number): Promise<void> {
  const res = await masterFetch(`${RAD_MATERIALS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const RAD_ITEMS_PATH = "/master/rad_items";

export async function searchRadItems(params: {
  name?: string;
  /** 名称・種別(モダリティ)・部位のどれかに当たる項目を1つの語で探す。 */
  keyword?: string;
  /** 項目コード。カンマ区切りで複数指定できる。 */
  item_code?: string;
  kind?: string;
  /** "true"=グループ化のみ / "false"=単独オーダーのみ。未指定なら両方。 */
  groupable?: string;
  modality_code?: string;
  body_part_code?: string;
  /** true なら今日オーダーできる項目(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<RadItemSearchResult> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.keyword) search.set("keyword", params.keyword);
  if (params.item_code) search.set("item_code", params.item_code);
  if (params.kind) search.set("kind", params.kind);
  if (params.groupable) search.set("groupable", params.groupable);
  if (params.modality_code) search.set("modality_code", params.modality_code);
  if (params.body_part_code) search.set("body_part_code", params.body_part_code);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${RAD_ITEMS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadItemSearchResult;
}

// 要素の名称とセット構成を添えた詳細。項目コードでも id でも引ける。
export async function fetchRadItem(idOrCode: string | number): Promise<RadItemDetail> {
  const res = await masterFetch(`${RAD_ITEMS_PATH}/${encodeURIComponent(String(idOrCode))}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadItemDetail;
}

export async function createRadItem(payload: RadItemPayload): Promise<RadItem> {
  const res = await masterFetch(RAD_ITEMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadItem;
}

export async function updateRadItem(id: number, payload: RadItemPayload): Promise<RadItem> {
  const res = await masterFetch(`${RAD_ITEMS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadItem;
}

export async function deleteRadItem(id: number): Promise<void> {
  const res = await masterFetch(`${RAD_ITEMS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function bulkCreateRadItemsFromFrequent(
  frequentCodeIds: number[],
): Promise<RadBulkCreateResult> {
  const res = await masterFetch(`${RAD_ITEMS_PATH}/bulk_create_from_frequent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frequent_code_ids: frequentCodeIds }),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadBulkCreateResult;
}

export async function searchRadSetItems(params: {
  /** セットの項目コード。カンマ区切りで複数指定できる。 */
  set_item_code?: string;
  member_item_code?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<RadSetItem>> {
  const search = new URLSearchParams();
  if (params.set_item_code) search.set("set_item_code", params.set_item_code);
  if (params.member_item_code) search.set("member_item_code", params.member_item_code);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/rad_set_items?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<RadSetItem>;
}

export async function createRadSetItem(payload: RadSetItemPayload): Promise<RadSetItem> {
  const res = await masterFetch("/master/rad_set_items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadSetItem;
}

export async function deleteRadSetItem(id: number): Promise<void> {
  const res = await masterFetch(`/master/rad_set_items/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

// 実施入力用データセット。実施入力で登録する手技料・造影剤・器材の組み合わせに
// 名前を付けたもので、撮影項目に紐付けておくと実施入力モーダルの初期明細になる。

export interface RadDataset {
  id: number;
  dataset_code: string;
  name: string;
  name_kana: string | null;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
}

/** データセット明細の種別。参照先マスタが決まる。 */
export type RadDatasetDetailType = "procedure" | "medicine" | "material";

export interface RadDatasetDetail {
  id: number;
  dataset_code: string;
  detail_type: RadDatasetDetailType;
  /** 参照先マスタのコード(診療行為コード / 医薬品コード / 施設内の器材コード)。 */
  code: string;
  /** 実施入力に初期表示する数量。造影剤は使用量(mL)、器材は本数など。手技は空。 */
  default_quantity: string | null;
  /** 造影剤の既定の投与経路(JP Core の route-codes)。 */
  route_code: string | null;
  /** 実施入力を開いたときに最初から並べるか。false は使ったときだけ検索して足す。 */
  default_selected: boolean;
  display_order: number | null;
  /** 参照先マスタから解決した名称。未取込・削除済みなら null。 */
  resolved_name: string | null;
  resolved_unit_name: string | null;
  /** 器材の算定用コード(レセプト電算の特定器材コード)。FHIR の usedCode に載せる。 */
  receipt_material_code: string | null;
  /** 造影剤の個別医薬品コード(YJコード)。処方・注射と揃えるために添える。 */
  yj_code: string | null;
}

export interface RadDatasetWithDetails extends RadDataset {
  details: RadDatasetDetail[];
}

export interface RadDatasetPayload {
  dataset_code?: string;
  name?: string;
  name_kana?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

export interface RadDatasetDetailPayload {
  dataset_code?: string;
  detail_type?: RadDatasetDetailType;
  code?: string;
  default_quantity?: string | null;
  route_code?: string | null;
  default_selected?: boolean;
  display_order?: number | null;
}

const RAD_DATASETS_PATH = "/master/rad_datasets";
const RAD_DATASET_DETAILS_PATH = "/master/rad_dataset_details";

export async function searchRadDatasets(params: {
  name?: string;
  /** データセットコード。カンマ区切りで複数指定できる。 */
  dataset_code?: string;
  /** true なら今日使えるデータセット(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<RadDataset>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.dataset_code) search.set("dataset_code", params.dataset_code);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${RAD_DATASETS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<RadDataset>;
}

// 明細を名称付きで添えた詳細。データセットコードでも id でも引ける。
export async function fetchRadDataset(idOrCode: string | number): Promise<RadDatasetWithDetails> {
  const res = await masterFetch(`${RAD_DATASETS_PATH}/${encodeURIComponent(String(idOrCode))}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadDatasetWithDetails;
}

export async function createRadDataset(payload: RadDatasetPayload): Promise<RadDataset> {
  const res = await masterFetch(RAD_DATASETS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadDataset;
}

export async function updateRadDataset(
  id: number,
  payload: RadDatasetPayload,
): Promise<RadDataset> {
  const res = await masterFetch(`${RAD_DATASETS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadDataset;
}

export async function deleteRadDataset(id: number): Promise<void> {
  const res = await masterFetch(`${RAD_DATASETS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function searchRadDatasetDetails(params: {
  /** データセットコード。カンマ区切りで複数指定できる(実施入力が一括で引く)。 */
  dataset_code?: string;
  detail_type?: RadDatasetDetailType;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<RadDatasetDetail>> {
  const search = new URLSearchParams();
  if (params.dataset_code) search.set("dataset_code", params.dataset_code);
  if (params.detail_type) search.set("detail_type", params.detail_type);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${RAD_DATASET_DETAILS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<RadDatasetDetail>;
}

export async function createRadDatasetDetail(
  payload: RadDatasetDetailPayload,
): Promise<RadDatasetDetail> {
  const res = await masterFetch(RAD_DATASET_DETAILS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadDatasetDetail;
}

export async function updateRadDatasetDetail(
  id: number,
  payload: RadDatasetDetailPayload,
): Promise<RadDatasetDetail> {
  const res = await masterFetch(`${RAD_DATASET_DETAILS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadDatasetDetail;
}

export async function deleteRadDatasetDetail(id: number): Promise<void> {
  const res = await masterFetch(`${RAD_DATASET_DETAILS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const RAD_ITEM_LAYOUTS_PATH = "/master/rad_item_layouts";

export async function fetchRadItemLayouts(): Promise<MasterSearchResult<RadItemLayout>> {
  const res = await masterFetch(`${RAD_ITEM_LAYOUTS_PATH}?per=100`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<RadItemLayout>;
}

export async function fetchRadItemLayout(id: number): Promise<RadItemLayoutDetail> {
  const res = await masterFetch(`${RAD_ITEM_LAYOUTS_PATH}/${id}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadItemLayoutDetail;
}

export async function createRadItemLayout(payload: RadItemLayoutPayload): Promise<RadItemLayout> {
  const res = await masterFetch(RAD_ITEM_LAYOUTS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadItemLayout;
}

export async function updateRadItemLayout(
  id: number,
  payload: RadItemLayoutPayload,
): Promise<RadItemLayoutDetail> {
  const res = await masterFetch(`${RAD_ITEM_LAYOUTS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadItemLayoutDetail;
}

export async function deleteRadItemLayout(id: number): Promise<void> {
  const res = await masterFetch(`${RAD_ITEM_LAYOUTS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function createRadItemLayoutCell(
  payload: RadItemLayoutCellPayload,
): Promise<RadItemLayoutCell> {
  const res = await masterFetch("/master/rad_item_layout_cells", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadItemLayoutCell;
}

export async function updateRadItemLayoutCell(
  id: number,
  payload: Partial<RadItemLayoutCellPayload>,
): Promise<RadItemLayoutCell> {
  const res = await masterFetch(`/master/rad_item_layout_cells/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RadItemLayoutCell;
}

export async function deleteRadItemLayoutCell(id: number): Promise<void> {
  const res = await masterFetch(`/master/rad_item_layout_cells/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
