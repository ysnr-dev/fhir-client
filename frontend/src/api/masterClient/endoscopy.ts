import {
  buildError,
  masterFetch,
  type MasterImportResult,
  type MasterSearchResult,
  type MasterType,
} from "./core";

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

// 内視鏡オーダー項目。
export interface EndoscopyItem {
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
  /** 検査種別(master_endoscopy_exam_types.exam_type_code)。未分類なら null。 */
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
   * 実施入力をする項目か。false の項目は内視鏡一覧の「実施」で実施入力を
   * 開かずそのまま実施済にし、実施記録を作らない(カルテにも実施情報は出ない)。
   */
  requires_perform_input: boolean;
  /**
   * 実施入力の初期明細になるデータセット(master_endoscopy_datasets)。1項目に1つで、
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
export type EndoscopyExamTypeNames = Record<string, string>;

export interface EndoscopyItemSearchResult extends MasterSearchResult<EndoscopyItem> {
  exam_types: EndoscopyExamTypeNames;
}

// セットの構成。member_name 以降は一覧・詳細APIがオーダー項目から付与する。
export interface EndoscopySetItem {
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

export interface EndoscopyItemDetail extends EndoscopyItem {
  exam_types: EndoscopyExamTypeNames;
  set_items: EndoscopySetItem[];
  /** dataset_code から解決したデータセット名。未指定・削除済みなら null。 */
  dataset_name: string | null;
}

export interface EndoscopyItemPayload {
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

export interface EndoscopySetItemPayload {
  set_item_code: string;
  member_item_code: string;
  display_order?: number | null;
  note?: string | null;
}

// 内視鏡オーダーレイアウト(伝票のようなグリッド)。1マスの中身は
// EndoscopyItemLayoutCell が持つ。
export interface EndoscopyItemLayout {
  id: number;
  name: string;
  row_count: number;
  column_count: number;
  display_order: number | null;
  active: boolean;
  note: string | null;
}

export interface EndoscopyItemLayoutCell {
  id: number;
  layout_id: number;
  grid_row: number;
  grid_column: number;
  // item=内視鏡オーダー項目 / label=表示専用の文言
  cell_type: string;
  item_code: string | null;
  // item: 伝票上の表示名(空ならオーダー項目名) / label: 表示文言
  display_name: string | null;
  item_name?: string | null;
  item_short_name?: string | null;
  item_kind?: string | null;
}

export interface EndoscopyItemLayoutDetail extends EndoscopyItemLayout {
  cells: EndoscopyItemLayoutCell[];
  // 行数・列数を縮めたとき、範囲外で片付けられたセルの数(update の応答のみ)。
  removed_cells?: number;
}

export interface EndoscopyItemLayoutPayload {
  name?: string;
  row_count?: number;
  column_count?: number;
  display_order?: number | null;
  active?: boolean;
  note?: string | null;
}

export interface EndoscopyItemLayoutCellPayload {
  layout_id: number;
  grid_row: number;
  grid_column: number;
  cell_type?: string;
  item_code?: string | null;
  display_name?: string | null;
}

// 実施入力用データセット。実施入力で登録する手技料・薬剤・器材の組み合わせに
// 名前を付けたもので、検査項目に紐付けておくと実施入力モーダルの初期明細になる。

export interface EndoscopyDataset {
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
export type EndoscopyDatasetDetailType = "procedure" | "medicine" | "material";

export interface EndoscopyDatasetDetail {
  id: number;
  dataset_code: string;
  detail_type: EndoscopyDatasetDetailType;
  /**
   * 参照先マスタのコード(診療行為コード / 医薬品コード / 特定器材コード)。
   * 放射線と違い器材は施設内マスタを挟まないので、これがそのまま算定用の
   * 特定保険医療材料コードになる。
   */
  code: string;
  /** 実施入力に初期表示する数量。薬剤は使用量、器材は本数など。手技は空。 */
  default_quantity: string | null;
  /** 薬剤の既定の投与経路(JP Core の route-codes)。 */
  route_code: string | null;
  /** 実施入力を開いたときに最初から並べるか。false は使ったときだけ検索して足す。 */
  default_selected: boolean;
  display_order: number | null;
  /** 参照先マスタから解決した名称。未取込・削除済みなら null。 */
  resolved_name: string | null;
  resolved_unit_name: string | null;
  /** 薬剤の個別医薬品コード(YJコード)。処方・注射と揃えるために添える。 */
  yj_code: string | null;
}

export interface EndoscopyDatasetWithDetails extends EndoscopyDataset {
  details: EndoscopyDatasetDetail[];
}

export interface EndoscopyDatasetPayload {
  dataset_code?: string;
  name?: string;
  name_kana?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

export interface EndoscopyDatasetDetailPayload {
  dataset_code?: string;
  detail_type?: EndoscopyDatasetDetailType;
  code?: string;
  default_quantity?: string | null;
  route_code?: string | null;
  default_selected?: boolean;
  display_order?: number | null;
}

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

const ENDOSCOPY_DATASETS_PATH = "/master/endoscopy_datasets";
const ENDOSCOPY_DATASET_DETAILS_PATH = "/master/endoscopy_dataset_details";

export async function searchEndoscopyDatasets(params: {
  name?: string;
  /** データセットコード。カンマ区切りで複数指定できる。 */
  dataset_code?: string;
  /** true なら今日使えるデータセット(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<EndoscopyDataset>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.dataset_code) search.set("dataset_code", params.dataset_code);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${ENDOSCOPY_DATASETS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<EndoscopyDataset>;
}

// 明細を名称付きで添えた詳細。データセットコードでも id でも引ける。
export async function fetchEndoscopyDataset(
  idOrCode: string | number,
): Promise<EndoscopyDatasetWithDetails> {
  const res = await masterFetch(`${ENDOSCOPY_DATASETS_PATH}/${encodeURIComponent(String(idOrCode))}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyDatasetWithDetails;
}

export async function createEndoscopyDataset(payload: EndoscopyDatasetPayload): Promise<EndoscopyDataset> {
  const res = await masterFetch(ENDOSCOPY_DATASETS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyDataset;
}

export async function updateEndoscopyDataset(
  id: number,
  payload: EndoscopyDatasetPayload,
): Promise<EndoscopyDataset> {
  const res = await masterFetch(`${ENDOSCOPY_DATASETS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyDataset;
}

export async function deleteEndoscopyDataset(id: number): Promise<void> {
  const res = await masterFetch(`${ENDOSCOPY_DATASETS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function searchEndoscopyDatasetDetails(params: {
  /** データセットコード。カンマ区切りで複数指定できる(実施入力が一括で引く)。 */
  dataset_code?: string;
  detail_type?: EndoscopyDatasetDetailType;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<EndoscopyDatasetDetail>> {
  const search = new URLSearchParams();
  if (params.dataset_code) search.set("dataset_code", params.dataset_code);
  if (params.detail_type) search.set("detail_type", params.detail_type);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${ENDOSCOPY_DATASET_DETAILS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<EndoscopyDatasetDetail>;
}

export async function createEndoscopyDatasetDetail(
  payload: EndoscopyDatasetDetailPayload,
): Promise<EndoscopyDatasetDetail> {
  const res = await masterFetch(ENDOSCOPY_DATASET_DETAILS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyDatasetDetail;
}

export async function updateEndoscopyDatasetDetail(
  id: number,
  payload: EndoscopyDatasetDetailPayload,
): Promise<EndoscopyDatasetDetail> {
  const res = await masterFetch(`${ENDOSCOPY_DATASET_DETAILS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyDatasetDetail;
}

export async function deleteEndoscopyDatasetDetail(id: number): Promise<void> {
  const res = await masterFetch(`${ENDOSCOPY_DATASET_DETAILS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const ENDOSCOPY_ITEM_LAYOUTS_PATH = "/master/endoscopy_item_layouts";

export async function fetchEndoscopyItemLayouts(): Promise<MasterSearchResult<EndoscopyItemLayout>> {
  const res = await masterFetch(`${ENDOSCOPY_ITEM_LAYOUTS_PATH}?per=100`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<EndoscopyItemLayout>;
}

export async function fetchEndoscopyItemLayout(id: number): Promise<EndoscopyItemLayoutDetail> {
  const res = await masterFetch(`${ENDOSCOPY_ITEM_LAYOUTS_PATH}/${id}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyItemLayoutDetail;
}

export async function createEndoscopyItemLayout(
  payload: EndoscopyItemLayoutPayload,
): Promise<EndoscopyItemLayout> {
  const res = await masterFetch(ENDOSCOPY_ITEM_LAYOUTS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyItemLayout;
}

export async function updateEndoscopyItemLayout(
  id: number,
  payload: EndoscopyItemLayoutPayload,
): Promise<EndoscopyItemLayoutDetail> {
  const res = await masterFetch(`${ENDOSCOPY_ITEM_LAYOUTS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyItemLayoutDetail;
}

export async function deleteEndoscopyItemLayout(id: number): Promise<void> {
  const res = await masterFetch(`${ENDOSCOPY_ITEM_LAYOUTS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function createEndoscopyItemLayoutCell(
  payload: EndoscopyItemLayoutCellPayload,
): Promise<EndoscopyItemLayoutCell> {
  const res = await masterFetch("/master/endoscopy_item_layout_cells", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyItemLayoutCell;
}

export async function updateEndoscopyItemLayoutCell(
  id: number,
  payload: Partial<EndoscopyItemLayoutCellPayload>,
): Promise<EndoscopyItemLayoutCell> {
  const res = await masterFetch(`/master/endoscopy_item_layout_cells/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as EndoscopyItemLayoutCell;
}

export async function deleteEndoscopyItemLayoutCell(id: number): Promise<void> {
  const res = await masterFetch(`/master/endoscopy_item_layout_cells/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

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
