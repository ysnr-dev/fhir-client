import { notifyUnauthorized, withCsrfHeaders } from "./session";

export type MasterType =
  | "hot_codes"
  | "medicines"
  | "medicine_usages"
  | "lab_items"
  | "diseases"
  | "modifiers"
  | "disease_indexes"
  | "jfagy_allergens"
  | "lab_specimens"
  | "rad_jj1017_codes"
  | "rad_frequent_codes";

export interface MasterImportResult {
  imported: number;
  /** 取り込めなかった行数。配布ファイルの欠番・桁不足・重複を数えるマスタだけが返す。 */
  skipped?: number;
  /** JJ1017 部品コード: 取り込んだ要素ごとの件数。 */
  elements?: Record<string, number>;
  /** JJ1017 頻用コード: 取り込んだ区分ごとの件数。 */
  categories?: Record<string, number>;
}

export interface Medicine {
  id: number;
  medicine_code: string;
  name: string;
  name_kana: string | null;
  unit_code: string | null;
  unit_name: string | null;
  dosage_form: string | null;
  // 注射容量(mL)。注射薬でも大半は "0"(アンプル・粉末製剤)で、未設定と区別できない。
  injection_volume: string | null;
  yakka_code: string | null;
  price: string | null;
  generic_name_description: string | null;
  abolished_on: string | null;
  // 薬効分類（YJコード上4桁 = 薬効分類番号）。検索APIが JOIN で付与する。
  yakko_code: string | null;
  yakko_name: string | null;
  // 個別医薬品コード（YJコード）。検索APIが HOTコードマスタから付与する。
  yj_code: string | null;
}

export interface MedicineType {
  id: number;
  code: string;
  name: string | null;
}

// 投与量の入力単位 → 医薬品マスタの薬価算定単位への換算。
// 入力値 ÷ factor = to_unit での数量（例: factor=20, to_unit="管" なら 20mL が 1管）。
export interface MedicineDoseConversion {
  id: number;
  medicine_code: string;
  from_unit: string;
  // decimal は JSON では文字列で返る。
  factor: string;
  to_unit: string;
  // explicit=規格単位に力価量が明示 / from_percent=濃度%から算出 /
  // volume=規格単位の容量から / identity=薬価算定単位が量そのもの / manual=手動登録
  source: string;
  needs_review: boolean;
  note: string | null;
  // 以下は一覧APIが医薬品マスタ・HOTコードマスタから JOIN で付与する。
  medicine_name: string | null;
  medicine_unit_name: string | null;
  dosage_form: string | null;
  standard_unit: string | null;
}

// 換算行を1件も持たない医薬品（手動メンテの対象）。
export interface UnmappedMedicine {
  id: number;
  medicine_code: string;
  name: string;
  unit_name: string | null;
  dosage_form: string | null;
  yakka_code: string | null;
  // HOTコードマスタの規格単位。空なら自動生成の材料そのものが無い。
  standard_unit: string | null;
}

export interface MedicineDoseConversionPayload {
  medicine_code: string;
  from_unit: string;
  factor: number;
  to_unit?: string | null;
  note?: string | null;
  needs_review?: boolean;
}

export interface MedicineDoseConversionGenerateResult {
  created: number;
  medicines: number;
  skipped: number;
  unmapped: number;
  needs_review: number;
  /** 既存の医薬品に後から足した mL 行の数(点滴の総投与量を出すための補完)。 */
  volume_filled: number;
}

export interface MedicineUsage {
  id: number;
  usage_code: string;
  basic_usage_category_code: string | null;
  basic_usage_category: string | null;
  detailed_usage_category_code: string | null;
  detailed_usage_category: string | null;
  timing_category_code: string | null;
  timing_category: string | null;
  usage_name: string;
}

export interface LabItem {
  id: number;
  category_name: string | null;
  // 分析物レベルのまとめ(例: 総蛋白(TP))。同じ大項目が材料・測定法違いで
  // 多数の行に分かれるため、選択モーダルの段階的絞り込みの起点になる。
  major_item: string | null;
  fhir_item_name: string | null;
  abbreviation: string | null;
  jlac11_specimen: string | null;
  jlac11_method: string | null;
  jlac11_code: string;
  // JLAC10 でオーダーされた検査項目からマスタを引き当てるために使う。
  jlac10_code: string | null;
  display_unit: string | null;
  xml_unit: string | null;
  // PQ:数値型、CD:大小順序のないコード型、CO:大小順序のあるコード型、ST:文字列型
  data_type: string | null;
  // コード型の選択肢。「1：陽性、2：陰性」のような 区切り文字列
  code_value_list: string | null;
  // コード型の値の CodeSystem URL
  code_oid: string | null;
}

export interface Disease {
  id: number;
  management_number: string;
  name: string;
  name_kana: string | null;
  // 1:レベル1病名、2:レベル2病名、3:互換表記(同義語)
  adoption_category: string | null;
  // 病名交換用コード(4桁)
  exchange_code: string | null;
  icd10_2013: string | null;
  // レセ電算用傷病名コード
  receipt_code: string | null;
  // 00:制限なし、01:修飾語との組合せが望ましい
  single_use_prohibited_category: string | null;
}

export interface Modifier {
  id: number;
  management_number: string;
  name: string;
  name_kana: string | null;
  // 修飾語交換用コード
  exchange_code: string | null;
  // 10以上:病名の前に置く(接頭語)、9以下:後に置く(接尾語)
  connection_position_category: string | null;
  // 前から2桁目が分類(1:部位〜8:接尾語、9:歯科)
  modifier_category: string | null;
  // レセ電算用修飾語コード
  receipt_code: string | null;
}

export interface JfagyAllergen {
  id: number;
  jfagy_code: string;
  name: string;
  name_kana: string | null;
  name_en: string | null;
  // 階層レベル(1:領域〜6:結合語・別表記)
  level: string | null;
  // 1:主要品目(選択肢として代表的に提示される項目)
  main_flag: string | null;
  guideline: string | null;
}

export interface MasterSearchResult<T> {
  total: number;
  page: number;
  per: number;
  items: T[];
}

// ログインセッションは same-origin fetch に自動で載る。非 GET への CSRF
// トークン付与と 401(セッション失効)の通知だけを行う(fhirClient と同じ)。
async function masterFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const res = await fetch(url, { ...init, headers: withCsrfHeaders(method, init.headers) });
  if (res.status === 401) notifyUnauthorized();
  return res;
}

export class MasterApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MasterApiError";
    this.status = status;
  }
}

async function buildError(res: Response): Promise<MasterApiError> {
  let message = `サーバーエラーが発生しました (HTTP ${res.status})`;
  try {
    const body = (await res.json()) as { error?: string; errors?: string[] };
    if (body.error) message = body.error;
    else if (body.errors?.length) message = body.errors.join(" / ");
  } catch {
    // 非JSONレスポンスはデフォルトメッセージのまま
  }
  return new MasterApiError(message, res.status);
}

export async function searchMedicines(params: {
  name?: string;
  yakko_code?: string;
  yakko_name?: string;
  dosage_form?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<Medicine>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.yakko_code) search.set("yakko_code", params.yakko_code);
  if (params.yakko_name) search.set("yakko_name", params.yakko_name);
  if (params.dosage_form) search.set("dosage_form", params.dosage_form);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/medicines?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<Medicine>;
}

// 薬効分類の選択プルダウン用。全件を薬効分類番号順で返す（ページングなし）。
export async function fetchMedicineTypeOptions(): Promise<MedicineType[]> {
  const res = await masterFetch("/master/medicine_types/options");
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MedicineType[];
}

export async function searchMedicineUsages(params: {
  usage_name?: string;
  basic_usage_category?: string;
  detailed_usage_category?: string;
  timing_category?: string;
  dose_count?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<MedicineUsage>> {
  const search = new URLSearchParams();
  if (params.usage_name) search.set("usage_name", params.usage_name);
  if (params.basic_usage_category) search.set("basic_usage_category", params.basic_usage_category);
  if (params.detailed_usage_category)
    search.set("detailed_usage_category", params.detailed_usage_category);
  if (params.timing_category) search.set("timing_category", params.timing_category);
  if (params.dose_count) search.set("dose_count", params.dose_count);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/medicine_usages?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MedicineUsage>;
}

export interface MedicineUsageCategories {
  basic_usage_categories: string[];
  detailed_usage_categories: string[];
  timing_categories: string[];
  dose_counts: string[];
}

export async function fetchMedicineUsageCategories(): Promise<MedicineUsageCategories> {
  const res = await masterFetch("/master/medicine_usages/categories");
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MedicineUsageCategories;
}

// 検査項目選択モーダルの段階的絞り込み(区分名称 → 大項目 → 材料 → 測定法)。
export interface LabItemDrilldown {
  category_name?: string;
  major_item?: string;
  jlac11_specimen?: string;
  jlac11_method?: string;
}

function appendDrilldown(search: URLSearchParams, drilldown: LabItemDrilldown): void {
  if (drilldown.category_name) search.set("category_name", drilldown.category_name);
  if (drilldown.major_item) search.set("major_item", drilldown.major_item);
  if (drilldown.jlac11_specimen) search.set("jlac11_specimen", drilldown.jlac11_specimen);
  if (drilldown.jlac11_method) search.set("jlac11_method", drilldown.jlac11_method);
}

export async function searchLabItems(
  params: LabItemDrilldown & {
    name?: string;
    // JLAC コードはどちらもカンマ区切りで複数指定できる。
    jlac11_code?: string;
    jlac10_code?: string;
    page?: number;
    per?: number;
  },
): Promise<MasterSearchResult<LabItem>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.jlac11_code) search.set("jlac11_code", params.jlac11_code);
  if (params.jlac10_code) search.set("jlac10_code", params.jlac10_code);
  appendDrilldown(search, params);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/lab_items?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<LabItem>;
}

// 段階的絞り込みの4リストぶんの選択肢。上位の選択で絞り込まれた値が返る
// (区分名称だけは絞り込みに関係なく全件)。
export interface LabItemFilterOptions {
  category_names: string[];
  major_items: string[];
  specimens: string[];
  methods: string[];
}

export async function fetchLabItemFilterOptions(
  params: LabItemDrilldown & { name?: string },
): Promise<LabItemFilterOptions> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  appendDrilldown(search, params);

  const res = await masterFetch(`/master/lab_items/filter_options?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabItemFilterOptions;
}

export async function searchDiseases(params: {
  name?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<Disease>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  // 削除区分レコード(過去版から削除された病名)は選択対象にしない
  search.set("exclude_deleted", "1");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/diseases?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<Disease>;
}

export async function searchModifiers(params: {
  name?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<Modifier>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  search.set("exclude_deleted", "1");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/modifiers?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<Modifier>;
}

export async function searchJfagyAllergens(params: {
  name?: string;
  // 領域(メタコード3桁目)。F:食品、M:医薬品、N:非食品・非医薬品
  domain?: string;
  // 階層プレフィックス(例: J9FA=農産食品の配下)
  code_prefix?: string;
  // 階層レベル(1〜6)
  level?: string;
  // 主要品目(MAINFLAG=1)のみに絞る
  main_only?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<JfagyAllergen>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.domain) search.set("domain", params.domain);
  if (params.code_prefix) search.set("code_prefix", params.code_prefix);
  if (params.level) search.set("level", params.level);
  if (params.main_only) search.set("main_only", "1");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/jfagy_allergens?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<JfagyAllergen>;
}

const DOSE_CONVERSIONS_PATH = "/master/medicine_dose_conversions";

export async function searchMedicineDoseConversions(params: {
  name?: string;
  /** 医薬品コード。カンマ区切りで複数指定できる。 */
  medicine_code?: string;
  from_unit?: string;
  source?: string;
  dosage_form?: string;
  needs_review?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<MedicineDoseConversion>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.medicine_code) search.set("medicine_code", params.medicine_code);
  if (params.from_unit) search.set("from_unit", params.from_unit);
  if (params.source) search.set("source", params.source);
  if (params.dosage_form) search.set("dosage_form", params.dosage_form);
  if (params.needs_review) search.set("needs_review", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${DOSE_CONVERSIONS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MedicineDoseConversion>;
}

export async function searchUnmappedMedicines(params: {
  name?: string;
  dosage_form?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<UnmappedMedicine>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.dosage_form) search.set("dosage_form", params.dosage_form);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${DOSE_CONVERSIONS_PATH}/unmapped?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<UnmappedMedicine>;
}

// 未紐付けの医薬品にだけ換算行を作る。既存行（手動メンテ分を含む）は上書きしない。
export async function generateMedicineDoseConversions(): Promise<MedicineDoseConversionGenerateResult> {
  const res = await masterFetch(`${DOSE_CONVERSIONS_PATH}/generate`, { method: "POST" });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MedicineDoseConversionGenerateResult;
}

export async function createMedicineDoseConversion(
  payload: MedicineDoseConversionPayload,
): Promise<MedicineDoseConversion> {
  const res = await masterFetch(DOSE_CONVERSIONS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MedicineDoseConversion;
}

export async function updateMedicineDoseConversion(
  id: number,
  payload: Partial<MedicineDoseConversionPayload>,
): Promise<MedicineDoseConversion> {
  const res = await masterFetch(`${DOSE_CONVERSIONS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MedicineDoseConversion;
}

export async function deleteMedicineDoseConversion(id: number): Promise<void> {
  const res = await masterFetch(`${DOSE_CONVERSIONS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

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
  display_order: number | null;
  note: string | null;
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
}

export interface RadItemDetail extends RadItem {
  elements: RadElementNames;
  set_items: RadSetItem[];
}

export interface RadItemPayload {
  item_code?: string;
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  kind?: string;
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
  display_order?: number | null;
  note?: string | null;
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

const RAD_ITEMS_PATH = "/master/rad_items";

export async function searchRadItems(params: {
  name?: string;
  /** 項目コード。カンマ区切りで複数指定できる。 */
  item_code?: string;
  kind?: string;
  modality_code?: string;
  body_part_code?: string;
  /** true なら今日オーダーできる項目(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<RadItemSearchResult> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.item_code) search.set("item_code", params.item_code);
  if (params.kind) search.set("kind", params.kind);
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
