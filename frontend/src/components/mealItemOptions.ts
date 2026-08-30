// 食事オーダーのマスタの画面表示で共通に使うラベル。マスタの編集画面とオーダー
// 画面が同じ見せ方をするためにここへまとめる。
//
// staple は SS-MIX2 の給食オーダ(OMD^O03)の ODS-1 でいう D(主食)にあたる。食種
// (T、食止めを含む)は別マスタ(MealDiet)。嗜好品(P)・補助食(S)は今回扱わない。
//
// side_dish_form(副食形態: きざみ・ミキサー など)は SS-MIX2 に対応する ODS-1 区分が
// 無く、参考仕様(名古屋第二赤十字病院「食種選択によるオーダエントリ」§2)から採った。

export const MEAL_ITEM_KIND_LABELS: Record<string, string> = {
  staple: "主食",
  side_dish_form: "副食形態",
};

// 食種の主成分量。列名は MealDiet の列と対で、表示順もこのまま。
// 値は 1 日あたりの標準値(docs/meal-order-design.md §3.3)。
export const MEAL_NUTRIENT_COLUMNS = [
  { key: "energy_kcal", label: "熱量", unit: "kcal" },
  { key: "protein_g", label: "蛋白質", unit: "g" },
  { key: "fat_g", label: "脂質", unit: "g" },
  { key: "carbohydrate_g", label: "糖質", unit: "g" },
  { key: "water_ml", label: "水分", unit: "ml" },
  { key: "salt_g", label: "塩分", unit: "g" },
] as const;

export type MealNutrientKey = (typeof MEAL_NUTRIENT_COLUMNS)[number]["key"];

/** decimal が文字列で届くので、末尾の ".0" を落として「1600」「5.5」の形にする。 */
export function formatMealNutrient(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return String(n);
}

/** 主成分量か適応のどれか 1 つでも入っている食種か(成分帯を出すかの判定)。 */
export function mealDietHasNutrients(
  diet: Partial<Record<MealNutrientKey, string | null>> & { indication?: string | null },
): boolean {
  return MEAL_NUTRIENT_COLUMNS.some((c) => diet[c.key]) || Boolean(diet.indication);
}

// 種別(master_meal_categories)の給与形態。参考仕様 §1 の分類にあたり、オーダー画面が
// 入力欄を切り替える判断軸になる。値は Master::MealCategory::NUTRITION_FORMS と対で、
// 名前は FHIR NutritionOrder の要素名(oralDiet / enteralFormula)に寄せてある。
//
// 「欠食」はこの軸に入れない。食止めは食種マスタの is_fasting が担当する
// (docs/meal-order-design.md §2.5)。

export const MEAL_NUTRITION_FORM_OPTIONS = [
  { code: "oral_diet", label: "普通食・治療食" },
  { code: "enteral_formula", label: "経管・経口食" },
  { code: "infant_formula", label: "調乳食" },
] as const;

/** 未設定・知らない値は既定の「普通食・治療食」として扱う(後方互換)。 */
export const DEFAULT_MEAL_NUTRITION_FORM = "oral_diet";

export function mealNutritionFormLabel(
  code: string | null | undefined,
): string {
  return MEAL_NUTRITION_FORM_OPTIONS.find((o) => o.code === code)?.label ?? "";
}
