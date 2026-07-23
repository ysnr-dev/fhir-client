export type MasterType = "hot_codes" | "medicines" | "medicine_usages";

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

export interface MasterSearchResult<T> {
  total: number;
  page: number;
  per: number;
  items: T[];
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
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<Medicine>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.yakko_code) search.set("yakko_code", params.yakko_code);
  if (params.yakko_name) search.set("yakko_name", params.yakko_name);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await fetch(`/master/medicines?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<Medicine>;
}

// 薬効分類の選択プルダウン用。全件を薬効分類番号順で返す（ページングなし）。
export async function fetchMedicineTypeOptions(): Promise<MedicineType[]> {
  const res = await fetch("/master/medicine_types/options");
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

  const res = await fetch(`/master/medicine_usages?${search.toString()}`);
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
  const res = await fetch("/master/medicine_usages/categories");
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MedicineUsageCategories;
}

export async function importMaster(
  masterType: MasterType,
  file: File,
): Promise<MasterImportResult> {
  const formData = new FormData();
  formData.append("file", file);

  // Content-Type は指定しない（ブラウザが multipart boundary 付きで設定する）
  const res = await fetch(`/master/${masterType}/import`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterImportResult;
}
