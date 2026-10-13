import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- パターン食 ----
// 術後の食上げ(流動食 → 三分粥 → … → 常食)のように段階的に変わる食事の雛形。
// 食事オーダー画面で選ぶと、段階ごとのオーダーが食数で刻んだ期間でまとめて立つ
// (fhir/mealPatternHelpers)。段階の中身はフォーム値の部分集合で、backend は形だけを見る。

/**
 * 段階。食事オーダーのフォーム値(MealOrderFormValues)から期間とプロブレムを除いたもの + 食数。
 * backend は中身を解釈しないので、型はフロント側(fhir/mealPatternHelpers の MealPatternStep)で縛る。
 */
export type MealPatternStepJson = Record<string, unknown> & { meals: number | null };

export interface MealPattern {
  id: number;
  pattern_code: string;
  name: string;
  name_kana: string | null;
  steps: MealPatternStepJson[];
  display_order: number | null;
  note: string | null;
}

export interface MealPatternPayload {
  pattern_code?: string;
  name?: string;
  name_kana?: string | null;
  steps?: MealPatternStepJson[];
  display_order?: number | null;
  note?: string | null;
}

const MEAL_PATTERNS_PATH = "/master/meal_patterns";

export async function fetchMealPatterns(): Promise<MasterSearchResult<MealPattern>> {
  const res = await masterFetch(`${MEAL_PATTERNS_PATH}?per=500`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MealPattern>;
}

export async function createMealPattern(payload: MealPatternPayload): Promise<MealPattern> {
  const res = await masterFetch(MEAL_PATTERNS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MealPattern;
}

export async function updateMealPattern(
  id: number,
  payload: MealPatternPayload,
): Promise<MealPattern> {
  const res = await masterFetch(`${MEAL_PATTERNS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MealPattern;
}

export async function deleteMealPattern(id: number): Promise<void> {
  const res = await masterFetch(`${MEAL_PATTERNS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
