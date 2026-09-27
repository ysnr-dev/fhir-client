import { buildError, masterFetch, type MasterSearchResult } from "./core";
import { DOSE_CONVERSIONS_PATH } from "./ctcae";

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
  // 規制区分(0:該当しない 1:麻薬 2:毒薬 3:覚醒剤原料 5:向精神薬)。薬剤の印に使う。
  narcotic_category?: string | null;
  // 生物由来製品(1:該当)。
  biological_product_flag?: string | null;
  // 造影剤区分(0:該当しない 1:造影剤 2:造影の補助剤)。
  contrast_medium_category?: string | null;
  // 一般名処方(【般】〜)の候補。true のとき medicine_code はレセプト電算コードでは
  // なく一般名処方コード、name は一般名記載になる。銘柄検索の結果には付かない。
  generic?: boolean;
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

export async function searchMedicines(params: {
  name?: string;
  yakko_code?: string;
  yakko_name?: string;
  dosage_form?: string;
  /** true なら造影剤とその補助剤(発泡顆粒・腸管洗浄剤)だけ。放射線検査で使う。 */
  contrast_medium?: boolean;
  /** true なら銘柄ではなく一般名処方(【般】〜)の候補を返す。院外処方の一般名処方で使う。 */
  generic?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<Medicine>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.yakko_code) search.set("yakko_code", params.yakko_code);
  if (params.yakko_name) search.set("yakko_name", params.yakko_name);
  if (params.dosage_form) search.set("dosage_form", params.dosage_form);
  if (params.contrast_medium) search.set("contrast_medium", "true");
  if (params.generic) search.set("generic", "true");
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
export interface JlacItemDrilldown {
  category_name?: string;
  major_item?: string;
  jlac11_specimen?: string;
  jlac11_method?: string;
}

export function appendDrilldown(search: URLSearchParams, drilldown: JlacItemDrilldown): void {
  if (drilldown.category_name) search.set("category_name", drilldown.category_name);
  if (drilldown.major_item) search.set("major_item", drilldown.major_item);
  if (drilldown.jlac11_specimen) search.set("jlac11_specimen", drilldown.jlac11_specimen);
  if (drilldown.jlac11_method) search.set("jlac11_method", drilldown.jlac11_method);
}

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
