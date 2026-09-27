import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 食事オーダーのマスタ ----
//
// 食種(kind = diet)と主食(kind = staple)を1テーブルに入れたもの。列構成が同じで、
// オーダー側は FHIR の CodeSystem URI で既に区別しているため分けていない。
// 他の部門オーダーと違いセット・レイアウト・データセット・予約枠を持たない。

/**
 * 食種の種別(分類)。一般食・特別食(治療食)など、食種をまとめる 1 段の分類。
 * 手術の SurgeryCategory と違い階層は持たず、主食(kind = staple)には付かない。
 */
export interface MealCategory {
  id: number;
  category_code: string;
  name: string;
  name_kana: string | null;
  /**
   * 給与形態(oral_diet / enteral_formula / infant_formula)。名称と違い施設が自由に
   * 付けられない固定コードで、オーダー画面が入力欄を切り替える判断軸になる。
   */
  nutrition_form: string;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
}

export interface MealCategoryPayload {
  category_code?: string;
  name?: string;
  name_kana?: string | null;
  nutrition_form?: string;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

const MEAL_CATEGORIES_PATH = "/master/meal_categories";

export async function searchMealCategories(params: {
  name?: string;
  /** 種別コード。カンマ区切りで複数指定できる。 */
  category_code?: string;
  /** true なら今日使える種別(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<MealCategory>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.category_code) search.set("category_code", params.category_code);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${MEAL_CATEGORIES_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MealCategory>;
}

export async function createMealCategory(payload: MealCategoryPayload): Promise<MealCategory> {
  const res = await masterFetch(MEAL_CATEGORIES_PATH, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MealCategory;
}

export async function updateMealCategory(
  id: number,
  payload: MealCategoryPayload,
): Promise<MealCategory> {
  const res = await masterFetch(`${MEAL_CATEGORIES_PATH}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MealCategory;
}

export async function deleteMealCategory(id: number): Promise<void> {
  const res = await masterFetch(`${MEAL_CATEGORIES_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export interface MealDiet {
  id: number;
  item_code: string;
  name: string;
  name_kana: string | null;
  /**
   * 食止め(禁食)の食種か。オーダー画面で主食欄を無効にするために使う。
   * SS-MIX2 が食止めを食種コード(NPO)で表すのに合わせ、食種の一種として持つ。
   */
  is_fasting: boolean;
  /** 種別(master_meal_categories.category_code)。未分類なら null。 */
  category_code: string | null;
  /**
   * 主成分量。1 日あたり(朝昼夕の合計)の標準値で、JSON では decimal が文字列で届く。
   * 未登録は null。オーダーには写さない(食種の性質。docs/meal-order-design.md §3.3)。
   */
  energy_kcal: string | null;
  protein_g: string | null;
  fat_g: string | null;
  /** 画面表記は「糖質」。 */
  carbohydrate_g: string | null;
  water_ml: string | null;
  /** 食種の標準塩分量。オーダーの塩分制限(患者ごとの指示)とは別物。 */
  salt_g: string | null;
  /** 適応・備考。オーダー画面の食種選択で医師に見せる文(note はマスタ管理者の控え)。 */
  indication: string | null;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
}

export interface MealDietPayload {
  item_code?: string;
  name?: string;
  name_kana?: string | null;
  is_fasting?: boolean;
  category_code?: string | null;
  energy_kcal?: number | null;
  protein_g?: number | null;
  fat_g?: number | null;
  carbohydrate_g?: number | null;
  water_ml?: number | null;
  salt_g?: number | null;
  indication?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

const MEAL_DIETS_PATH = "/master/meal_diets";

export async function searchMealDiets(params: {
  name?: string;
  /** 食種コード。カンマ区切りで複数指定できる。 */
  item_code?: string;
  /** 種別。 */
  category_code?: string;
  /** true なら今日オーダーできる食種(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  /** 食種選択の表は全件を 1 ページで引くので、backend は 500 まで許す。 */
  per?: number;
}): Promise<MasterSearchResult<MealDiet>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.item_code) search.set("item_code", params.item_code);
  if (params.category_code) search.set("category_code", params.category_code);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${MEAL_DIETS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MealDiet>;
}

// 食種コードでも id でも引ける。
export async function fetchMealDiet(idOrCode: string | number): Promise<MealDiet> {
  const res = await masterFetch(`${MEAL_DIETS_PATH}/${encodeURIComponent(String(idOrCode))}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MealDiet;
}

export async function createMealDiet(payload: MealDietPayload): Promise<MealDiet> {
  const res = await masterFetch(MEAL_DIETS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MealDiet;
}

export async function updateMealDiet(id: number, payload: MealDietPayload): Promise<MealDiet> {
  const res = await masterFetch(`${MEAL_DIETS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MealDiet;
}

export async function deleteMealDiet(id: number): Promise<void> {
  const res = await masterFetch(`${MEAL_DIETS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export interface MealItem {
  id: number;
  item_code: string;
  name: string;
  name_kana: string | null;
  /** staple=主食 / side_dish_form=副食形態。食種は MealDiet(別テーブル)。 */
  kind: string;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
}

export interface MealItemPayload {
  item_code?: string;
  name?: string;
  name_kana?: string | null;
  kind?: string;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

const MEAL_ITEMS_PATH = "/master/meal_items";

export async function searchMealItems(params: {
  name?: string;
  /** 項目コード。カンマ区切りで複数指定できる。 */
  item_code?: string;
  /** "staple"=主食 / "side_dish_form"=副食形態。未指定なら両方。 */
  kind?: string;
  /** true なら今日オーダーできる項目(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<MealItem>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.item_code) search.set("item_code", params.item_code);
  if (params.kind) search.set("kind", params.kind);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${MEAL_ITEMS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MealItem>;
}

// 項目コードでも id でも引ける。
export async function fetchMealItem(idOrCode: string | number): Promise<MealItem> {
  const res = await masterFetch(`${MEAL_ITEMS_PATH}/${encodeURIComponent(String(idOrCode))}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MealItem;
}

export async function createMealItem(payload: MealItemPayload): Promise<MealItem> {
  const res = await masterFetch(MEAL_ITEMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MealItem;
}

export async function updateMealItem(id: number, payload: MealItemPayload): Promise<MealItem> {
  const res = await masterFetch(`${MEAL_ITEMS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MealItem;
}

export async function deleteMealItem(id: number): Promise<void> {
  const res = await masterFetch(`${MEAL_ITEMS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
