/**
 * 食種を選ぶときに並べる、患者の栄養量の目安(docs/meal-order-design.md §3.6)。
 *
 * 標準体重(BMI 22)に係数を掛けた幅で出す。係数は日本糖尿病学会の目標体重 ×
 * エネルギー係数(軽い労作 25〜30 kcal/kg)と、蛋白質 1.0〜1.2 g/kg。病態ごとの
 * 制限(腎臓食の蛋白など)は食種の適応で読むもので、ここでは一般的な目安だけを出す。
 * BMI 22 の標準体重は小児に当てはまらないので、18 歳未満では出さない。
 */

import type { BodyMeasureSummary } from "./bodyMeasureHelpers";

const STANDARD_BMI = 22;
const ENERGY_PER_KG = [25, 30] as const;
const PROTEIN_PER_KG = [1.0, 1.2] as const;
const ADULT_AGE = 18;

export interface MealNutritionTarget {
  /** 標準体重(kg、小数 1 桁)。 */
  standardWeight: number;
  /** 熱量の目安(kcal/日、10 kcal 単位)。 */
  energy: readonly [number, number];
  /** 蛋白質の目安(g/日、整数)。 */
  protein: readonly [number, number];
}

/** 身長(cm)が無い、または 18 歳未満なら null。年齢が分からないときは成人として扱う。 */
export function mealNutritionTarget(
  body: BodyMeasureSummary,
  age: number | undefined,
): MealNutritionTarget | null {
  if (age !== undefined && age < ADULT_AGE) return null;
  const height = body.height?.value;
  if (!height || height <= 0) return null;

  const weight = STANDARD_BMI * (height / 100) ** 2;
  return {
    standardWeight: Math.round(weight * 10) / 10,
    energy: [
      Math.round((weight * ENERGY_PER_KG[0]) / 10) * 10,
      Math.round((weight * ENERGY_PER_KG[1]) / 10) * 10,
    ],
    protein: [Math.round(weight * PROTEIN_PER_KG[0]), Math.round(weight * PROTEIN_PER_KG[1])],
  };
}

/** 主成分量の列(MEAL_NUTRIENT_COLUMNS の key)のうち、目安と比べるものの幅。 */
export function mealTargetRangeOf(
  key: string,
  target: MealNutritionTarget | null,
): readonly [number, number] | null {
  if (!target) return null;
  if (key === "energy_kcal") return target.energy;
  if (key === "protein_g") return target.protein;
  return null;
}

export type MealTargetComparison = "below" | "above" | null;

/** 食種の値(マスタの decimal 文字列)が目安の幅を外れていれば、どちら側か。 */
export function compareToMealTarget(
  value: string | null | undefined,
  range: readonly [number, number],
): MealTargetComparison {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (n < range[0]) return "below";
  if (n > range[1]) return "above";
  return null;
}

export const MEAL_TARGET_COMPARISON_LABELS: Record<"below" | "above", string> = {
  below: "目安未満",
  above: "目安超",
};
