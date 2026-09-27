import { buildError, masterFetch, type MasterSearchResult } from "./core";

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

// 剤形・規格・銘柄不明コードマスタ(J-FAGY医薬品領域)。jfagy_code は
// GCM+一般名コード(規格・銘柄部 ZZZ)の15桁、name は薬剤成分名。
export interface JfagyDrug {
  id: number;
  jfagy_code: string;
  name: string;
  record_date: string | null;
  end_date: string | null;
  change_category: string | null;
}

export async function searchJfagyDrugs(params: {
  name?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<JfagyDrug>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/jfagy_drugs?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<JfagyDrug>;
}
