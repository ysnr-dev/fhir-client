import { notifyUnauthorized, withCsrfHeaders } from "./session";

export type MasterType =
  | "hot_codes"
  | "medicines"
  | "medicine_usages"
  | "lab_items"
  | "diseases"
  | "modifiers"
  | "disease_indexes"
  | "jfagy_allergens";

export interface MasterImportResult {
  imported: number;
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
  fhir_item_name: string | null;
  abbreviation: string | null;
  jlac11_specimen: string | null;
  jlac11_method: string | null;
  jlac11_code: string;
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

export async function searchLabItems(params: {
  name?: string;
  category_name?: string;
  jlac11_code?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<LabItem>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.category_name) search.set("category_name", params.category_name);
  if (params.jlac11_code) search.set("jlac11_code", params.jlac11_code);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/lab_items?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<LabItem>;
}

export interface LabItemCategories {
  category_names: string[];
}

export async function fetchLabItemCategories(): Promise<LabItemCategories> {
  const res = await masterFetch("/master/lab_items/categories");
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabItemCategories;
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
