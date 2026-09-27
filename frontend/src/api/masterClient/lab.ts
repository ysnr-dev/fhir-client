import { buildError, masterFetch, type MasterSearchResult } from "./core";

// 検体検査オーダー項目。医師がオーダー画面で選ぶ単位の検査項目で、
// JLAC コードは共有項目JLACコードマスタから検索して代表コードを1つ設定する。
export interface LabOrderItem {
  id: number;
  order_item_code: string;
  name: string;
  short_name: string | null;
  name_kana: string | null;
  // 検査分野(生化学検査 / 血液学的検査 など)
  category: string | null;
  // 検体(master_lab_specimens.specimen_code)
  specimen_code: string | null;
  // 採取管の上書き。空なら検体マスタの既定採取管を使う。
  container_code: string | null;
  // single=単項目 / panel=複数項目をまとめて依頼するもの
  kind: string;
  jlac_code: string | null;
  // jlac10 | jlac11
  jlac_code_system: string | null;
  valid_from: string | null;
  valid_to: string | null;
  // in_house=院内 / outsourced=外注
  execution_type: string | null;
  receipt_code: string | null;
  display_order: number | null;
  note: string | null;
}

// パネルの構成。member_name 以降は詳細APIがオーダー項目から付与する。
export interface LabPanelItem {
  id: number;
  panel_item_code: string;
  member_item_code: string;
  display_order: number | null;
  // required / optional / conditional
  member_type: string;
  note: string | null;
  member_name?: string | null;
  member_short_name?: string | null;
  member_kind?: string | null;
}

// 検体(材料)。JLAC11 の材料コード一覧から取り込む。略称・既定採取管は手入力。
export interface LabSpecimen {
  id: number;
  specimen_code: string;
  name: string;
  short_name: string | null;
  // 検体分類(配布ファイルのグループ見出し)
  category: string | null;
  parent_specimen_code: string | null;
  recommended: boolean;
  jlac10_specimen_code: string | null;
  // 既定採取管(master_lab_containers.container_code)
  default_container_code: string | null;
  display_order: number | null;
  name_kana: string | null;
  note: string | null;
}

// 採取管。呼称・キャップ色は施設で変わるのでマスタで持つ。
export interface LabContainer {
  id: number;
  container_code: string;
  name: string;
  short_name: string | null;
  cap_color: string | null;
  additive: string | null;
  capacity: string | null;
  display_order: number | null;
  note: string | null;
}

export interface LabOrderItemDetail extends LabOrderItem {
  specimen: LabSpecimen | null;
  // 項目の採取管指定が優先、無ければ検体の既定採取管。
  container: LabContainer | null;
  panel_items: LabPanelItem[];
  // この項目が返す結果項目(オーダー項目 → 結果項目の対応、結果項目を入れ子で持つ)。
  result_items: LabOrderItemResult[];
}

export interface LabOrderItemPayload {
  order_item_code?: string;
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  category?: string | null;
  specimen_code?: string | null;
  container_code?: string | null;
  kind?: string;
  jlac_code?: string | null;
  jlac_code_system?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  execution_type?: string | null;
  receipt_code?: string | null;
  display_order?: number | null;
  note?: string | null;
}

export interface LabPanelItemPayload {
  panel_item_code: string;
  member_item_code: string;
  member_type?: string;
  display_order?: number | null;
  note?: string | null;
}

// 検体検査の結果項目(施設マスタ)。検査結果として返ってくる単位で、結果値を表現する
// ための属性(データ型・単位・選択肢)を持つ。JLAC11 / JLAC10 / LOINC は任意の属性。
export interface LabResultItem {
  id: number;
  result_item_code: string;
  name: string;
  short_name: string | null;
  name_kana: string | null;
  // 検査分野(生化学検査 / 血液学的検査 など)。オーダー項目と同じ語彙。
  category: string | null;
  // 材料(master_lab_specimens.specimen_code)。結果の Specimen はこの値で作る。
  specimen_code: string | null;
  // 材料名。一覧・詳細 API が検体マスタから添える。
  specimen_name?: string | null;
  // PQ:数値型、CD:大小順序のないコード型、CO:大小順序のあるコード型、ST:文字列型
  data_type: string;
  display_unit: string | null;
  // UCUM 単位。Observation.valueQuantity.code に入れる。
  ucum_unit: string | null;
  // コード型の選択肢。「1：陽性、2：陰性」のような区切り文字列
  code_value_list: string | null;
  // コード型の値の CodeSystem URL
  value_code_system: string | null;
  decimal_places: number | null;
  jlac11_code: string | null;
  jlac10_code: string | null;
  loinc_code: string | null;
  // 測定法(試薬・機器の名称)。結果登録時に Observation.method へ写す。
  method_name: string | null;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
  // 基準値(性別・年齢帯ごと、表示順)。一覧・詳細・対応表の入れ子で API が添える。
  reference_ranges?: LabReferenceRange[];
}

// 結果項目の基準値とパニック値(緊急異常値)のしきい値。数値型(PQ)の結果項目に対する
// 性別・年齢帯ごとの境界で、どちらも同じ行に持つ。数値は Rails の decimal が文字列で届く。
export interface LabReferenceRange {
  id: number;
  result_item_code: string;
  // null = 共通 / male / female
  sex: string | null;
  // 適用する満年齢(歳)。null は開区間。
  age_from: number | null;
  age_to: number | null;
  lower_limit: string | null;
  upper_limit: string | null;
  // パニック値。これを下回る/上回ると緊急異常値(LL / HH)として扱う。
  panic_lower: string | null;
  panic_upper: string | null;
  display_order: number | null;
  note: string | null;
}

export interface LabReferenceRangePayload {
  result_item_code: string;
  sex?: string | null;
  age_from?: number | null;
  age_to?: number | null;
  lower_limit?: number | null;
  upper_limit?: number | null;
  panic_lower?: number | null;
  panic_upper?: number | null;
  display_order?: number | null;
  note?: string | null;
}

// この結果項目を返すオーダー項目。詳細 API がオーダー項目マスタから名称を添える。
export interface LabResultItemOrderRef {
  id: number;
  order_item_code: string;
  result_item_code: string;
  order_item_name?: string | null;
  order_item_kind?: string | null;
}

export interface LabResultItemDetail extends LabResultItem {
  specimen_name: string | null;
  reference_ranges: LabReferenceRange[];
  order_items: LabResultItemOrderRef[];
}

export interface LabResultItemPayload {
  result_item_code?: string;
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  category?: string | null;
  specimen_code?: string | null;
  data_type?: string;
  display_unit?: string | null;
  ucum_unit?: string | null;
  code_value_list?: string | null;
  value_code_system?: string | null;
  decimal_places?: number | null;
  jlac11_code?: string | null;
  jlac10_code?: string | null;
  loinc_code?: string | null;
  method_name?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

// オーダー項目 → 結果項目の対応(1:N)。result_item は一覧・詳細 API が入れ子で添える
// (結果項目がマスタから消えていれば null)。
export interface LabOrderItemResult {
  id: number;
  order_item_code: string;
  result_item_code: string;
  display_order: number | null;
  note: string | null;
  result_item: LabResultItem | null;
  // expand_panels で解決したときの要求元のオーダー項目コード(パネルをたどった場合は
  // order_item_code と異なる)。画面はこれでオーダーの項目ごとに行をまとめる。
  requested_order_item_code?: string;
}

export interface LabOrderItemResultPayload {
  order_item_code: string;
  result_item_code: string;
  display_order?: number | null;
  note?: string | null;
}

export interface LabSpecimenPayload {
  specimen_code?: string;
  name?: string;
  short_name?: string | null;
  category?: string | null;
  default_container_code?: string | null;
  note?: string | null;
}

export interface LabContainerPayload {
  container_code?: string;
  name?: string;
  short_name?: string | null;
  cap_color?: string | null;
  additive?: string | null;
  capacity?: string | null;
  display_order?: number | null;
  note?: string | null;
}

// 検査オーダーレイアウト(検査伝票のようなグリッド)。グリッドの大きさを持ち、
// 1マスの中身は LabOrderItemLayoutCell が持つ。
export interface LabOrderItemLayout {
  id: number;
  name: string;
  row_count: number;
  column_count: number;
  display_order: number | null;
  active: boolean;
  note: string | null;
}

// レイアウトの1マス。item=検査オーダー項目 / label=表示専用の文言。
// item_name 以降は詳細APIがオーダー項目から付与する。
export interface LabOrderItemLayoutCell {
  id: number;
  layout_id: number;
  grid_row: number;
  grid_column: number;
  cell_type: string;
  order_item_code: string | null;
  // item: 伝票上の表示名(空ならオーダー項目名) / label: 表示文言
  display_name: string | null;
  item_name?: string | null;
  item_short_name?: string | null;
  item_kind?: string | null;
}

export interface LabOrderItemLayoutDetail extends LabOrderItemLayout {
  cells: LabOrderItemLayoutCell[];
  // 行数・列数を縮めたとき、範囲外で片付けられたセルの数(update の応答のみ)。
  removed_cells?: number;
}

export interface LabOrderItemLayoutPayload {
  name?: string;
  row_count?: number;
  column_count?: number;
  display_order?: number | null;
  active?: boolean;
  note?: string | null;
}

export interface LabOrderItemLayoutCellPayload {
  layout_id: number;
  grid_row: number;
  grid_column: number;
  cell_type?: string;
  order_item_code?: string | null;
  display_name?: string | null;
}

const LAB_ORDER_ITEMS_PATH = "/master/lab_order_items";

export async function searchLabOrderItems(params: {
  name?: string;
  /** オーダー項目コード。カンマ区切りで複数指定できる。 */
  order_item_code?: string;
  kind?: string;
  category?: string;
  specimen_code?: string;
  /** true なら今日オーダーできる項目(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<LabOrderItem>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.order_item_code) search.set("order_item_code", params.order_item_code);
  if (params.kind) search.set("kind", params.kind);
  if (params.category) search.set("category", params.category);
  if (params.specimen_code) search.set("specimen_code", params.specimen_code);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${LAB_ORDER_ITEMS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<LabOrderItem>;
}

// 検体・採取管・パネル構成を添えた詳細。オーダー項目コードでも id でも引ける。
export async function fetchLabOrderItem(idOrCode: string | number): Promise<LabOrderItemDetail> {
  const res = await masterFetch(`${LAB_ORDER_ITEMS_PATH}/${encodeURIComponent(String(idOrCode))}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabOrderItemDetail;
}

export async function createLabOrderItem(payload: LabOrderItemPayload): Promise<LabOrderItem> {
  const res = await masterFetch(LAB_ORDER_ITEMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabOrderItem;
}

export async function updateLabOrderItem(
  id: number,
  payload: LabOrderItemPayload,
): Promise<LabOrderItem> {
  const res = await masterFetch(`${LAB_ORDER_ITEMS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabOrderItem;
}

export async function deleteLabOrderItem(id: number): Promise<void> {
  const res = await masterFetch(`${LAB_ORDER_ITEMS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function searchLabPanelItems(params: {
  /** パネルの項目コード。カンマ区切りで複数指定できる。 */
  panel_item_code?: string;
  member_item_code?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<LabPanelItem>> {
  const search = new URLSearchParams();
  if (params.panel_item_code) search.set("panel_item_code", params.panel_item_code);
  if (params.member_item_code) search.set("member_item_code", params.member_item_code);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/lab_panel_items?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<LabPanelItem>;
}

export async function createLabPanelItem(payload: LabPanelItemPayload): Promise<LabPanelItem> {
  const res = await masterFetch("/master/lab_panel_items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabPanelItem;
}

export async function updateLabPanelItem(
  id: number,
  payload: Partial<LabPanelItemPayload>,
): Promise<LabPanelItem> {
  const res = await masterFetch(`/master/lab_panel_items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabPanelItem;
}

export async function deleteLabPanelItem(id: number): Promise<void> {
  const res = await masterFetch(`/master/lab_panel_items/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const LAB_RESULT_ITEMS_PATH = "/master/lab_result_items";
const LAB_ORDER_ITEM_RESULTS_PATH = "/master/lab_order_item_results";

export async function searchLabResultItems(params: {
  name?: string;
  /** 結果項目コード・JLAC コード。いずれもカンマ区切りで複数指定できる。 */
  result_item_code?: string;
  jlac11_code?: string;
  /** JLAC11 の前方一致(測定物・識別・材料の 12 桁)。カンマ区切りで複数指定できる。 */
  jlac11_prefix?: string;
  jlac10_code?: string;
  category?: string;
  specimen_code?: string;
  /** データ型。カンマ区切りで複数指定できる。 */
  data_type?: string;
  /** true なら今日使える項目(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<LabResultItem>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.result_item_code) search.set("result_item_code", params.result_item_code);
  if (params.jlac11_code) search.set("jlac11_code", params.jlac11_code);
  if (params.jlac11_prefix) search.set("jlac11_prefix", params.jlac11_prefix);
  if (params.jlac10_code) search.set("jlac10_code", params.jlac10_code);
  if (params.category) search.set("category", params.category);
  if (params.specimen_code) search.set("specimen_code", params.specimen_code);
  if (params.data_type) search.set("data_type", params.data_type);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${LAB_RESULT_ITEMS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<LabResultItem>;
}

// 材料名と、この項目を返すオーダー項目を添えた詳細。結果項目コードでも id でも引ける。
export async function fetchLabResultItem(idOrCode: string | number): Promise<LabResultItemDetail> {
  const res = await masterFetch(`${LAB_RESULT_ITEMS_PATH}/${encodeURIComponent(String(idOrCode))}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabResultItemDetail;
}

export async function createLabResultItem(payload: LabResultItemPayload): Promise<LabResultItem> {
  const res = await masterFetch(LAB_RESULT_ITEMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabResultItem;
}

export async function updateLabResultItem(
  id: number,
  payload: LabResultItemPayload,
): Promise<LabResultItem> {
  const res = await masterFetch(`${LAB_RESULT_ITEMS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabResultItem;
}

export async function deleteLabResultItem(id: number): Promise<void> {
  const res = await masterFetch(`${LAB_RESULT_ITEMS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function searchLabOrderItemResults(params: {
  /** オーダー項目コード・結果項目コード。いずれもカンマ区切りで複数指定できる。 */
  order_item_code?: string;
  result_item_code?: string;
  /** 対応が無いオーダー項目をパネル構成でたどって結果項目まで解決する。 */
  expand_panels?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<LabOrderItemResult>> {
  const search = new URLSearchParams();
  if (params.order_item_code) search.set("order_item_code", params.order_item_code);
  if (params.result_item_code) search.set("result_item_code", params.result_item_code);
  if (params.expand_panels) search.set("expand_panels", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${LAB_ORDER_ITEM_RESULTS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<LabOrderItemResult>;
}

export async function createLabOrderItemResult(
  payload: LabOrderItemResultPayload,
): Promise<LabOrderItemResult> {
  const res = await masterFetch(LAB_ORDER_ITEM_RESULTS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabOrderItemResult;
}

export async function updateLabOrderItemResult(
  id: number,
  payload: Partial<LabOrderItemResultPayload>,
): Promise<LabOrderItemResult> {
  const res = await masterFetch(`${LAB_ORDER_ITEM_RESULTS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabOrderItemResult;
}

export async function deleteLabOrderItemResult(id: number): Promise<void> {
  const res = await masterFetch(`${LAB_ORDER_ITEM_RESULTS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const LAB_REFERENCE_RANGES_PATH = "/master/lab_reference_ranges";

export async function createLabReferenceRange(
  payload: LabReferenceRangePayload,
): Promise<LabReferenceRange> {
  const res = await masterFetch(LAB_REFERENCE_RANGES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabReferenceRange;
}

export async function updateLabReferenceRange(
  id: number,
  payload: Partial<LabReferenceRangePayload>,
): Promise<LabReferenceRange> {
  const res = await masterFetch(`${LAB_REFERENCE_RANGES_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabReferenceRange;
}

export async function deleteLabReferenceRange(id: number): Promise<void> {
  const res = await masterFetch(`${LAB_REFERENCE_RANGES_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const LAB_SPECIMENS_PATH = "/master/lab_specimens";

export async function searchLabSpecimens(params: {
  name?: string;
  /** 検体コード。カンマ区切りで複数指定できる。 */
  specimen_code?: string;
  category?: string;
  recommended?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<LabSpecimen>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.specimen_code) search.set("specimen_code", params.specimen_code);
  if (params.category) search.set("category", params.category);
  if (params.recommended) search.set("recommended", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${LAB_SPECIMENS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<LabSpecimen>;
}

export async function fetchLabSpecimenCategories(): Promise<string[]> {
  const res = await masterFetch(`${LAB_SPECIMENS_PATH}/categories`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as string[];
}

export async function createLabSpecimen(payload: LabSpecimenPayload): Promise<LabSpecimen> {
  const res = await masterFetch(LAB_SPECIMENS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabSpecimen;
}

export async function updateLabSpecimen(
  id: number,
  payload: LabSpecimenPayload,
): Promise<LabSpecimen> {
  const res = await masterFetch(`${LAB_SPECIMENS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabSpecimen;
}

export async function deleteLabSpecimen(id: number): Promise<void> {
  const res = await masterFetch(`${LAB_SPECIMENS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const LAB_CONTAINERS_PATH = "/master/lab_containers";

export async function searchLabContainers(params: {
  name?: string;
  /** 採取管コード。カンマ区切りで複数指定できる。 */
  container_code?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<LabContainer>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.container_code) search.set("container_code", params.container_code);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${LAB_CONTAINERS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<LabContainer>;
}

export async function createLabContainer(payload: LabContainerPayload): Promise<LabContainer> {
  const res = await masterFetch(LAB_CONTAINERS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabContainer;
}

export async function updateLabContainer(
  id: number,
  payload: LabContainerPayload,
): Promise<LabContainer> {
  const res = await masterFetch(`${LAB_CONTAINERS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabContainer;
}

export async function deleteLabContainer(id: number): Promise<void> {
  const res = await masterFetch(`${LAB_CONTAINERS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const LAB_LAYOUTS_PATH = "/master/lab_order_item_layouts";

export async function fetchLabOrderItemLayouts(): Promise<MasterSearchResult<LabOrderItemLayout>> {
  const res = await masterFetch(`${LAB_LAYOUTS_PATH}?per=100`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<LabOrderItemLayout>;
}

export async function fetchLabOrderItemLayout(id: number): Promise<LabOrderItemLayoutDetail> {
  const res = await masterFetch(`${LAB_LAYOUTS_PATH}/${id}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabOrderItemLayoutDetail;
}

export async function createLabOrderItemLayout(
  payload: LabOrderItemLayoutPayload,
): Promise<LabOrderItemLayout> {
  const res = await masterFetch(LAB_LAYOUTS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabOrderItemLayout;
}

export async function updateLabOrderItemLayout(
  id: number,
  payload: LabOrderItemLayoutPayload,
): Promise<LabOrderItemLayoutDetail> {
  const res = await masterFetch(`${LAB_LAYOUTS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabOrderItemLayoutDetail;
}

export async function deleteLabOrderItemLayout(id: number): Promise<void> {
  const res = await masterFetch(`${LAB_LAYOUTS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function createLabOrderItemLayoutCell(
  payload: LabOrderItemLayoutCellPayload,
): Promise<LabOrderItemLayoutCell> {
  const res = await masterFetch("/master/lab_order_item_layout_cells", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabOrderItemLayoutCell;
}

export async function updateLabOrderItemLayoutCell(
  id: number,
  payload: Partial<LabOrderItemLayoutCellPayload>,
): Promise<LabOrderItemLayoutCell> {
  const res = await masterFetch(`/master/lab_order_item_layout_cells/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabOrderItemLayoutCell;
}

export async function deleteLabOrderItemLayoutCell(id: number): Promise<void> {
  const res = await masterFetch(`/master/lab_order_item_layout_cells/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
