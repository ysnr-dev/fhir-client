import { summarizeAllergy } from "./allergyHelpers";
import { mealOrderAllergies, type MealAllergyRef } from "./mealOrderHelpers";

// 食物アレルギーと食事オーダーの照合(docs/meal-order-design.md §2.12)。
//
// 食事オーダーは出した時点の有効な食物アレルギーを supportingInfo に写す(AL1 相当)。
// 照合は「いま有効な食物アレルギーのうちオーダーに写っていないもの(未反映)」と
// 「オーダーに写っているが有効でなくなったもの(解消済み)」を id で突き合わせて出す。
// 食種の中身(卵を使うか)はマスタに持たないので、食種との照合はしない。

/** 給食部門に伝える対象になる食物アレルギーか(有効で、否定されていない食品のもの)。 */
export function isActiveFoodAllergy(allergy: fhir4.AllergyIntolerance): boolean {
  if (!allergy.category?.includes("food")) return false;
  const clinical = allergy.clinicalStatus?.coding?.[0]?.code;
  if (clinical && clinical !== "active") return false;
  return allergy.verificationStatus?.coding?.[0]?.code !== "refuted";
}

export function activeFoodAllergies(allergies: fhir4.AllergyIntolerance[]): fhir4.AllergyIntolerance[] {
  return allergies.filter(isActiveFoodAllergy);
}

/** オーダーに写す形。 */
export function mealAllergyRefOf(allergy: fhir4.AllergyIntolerance): MealAllergyRef {
  return { id: allergy.id ?? "", name: summarizeAllergy(allergy).name };
}

export function mealAllergyRefsOf(allergies: fhir4.AllergyIntolerance[]): MealAllergyRef[] {
  return activeFoodAllergies(allergies)
    .filter((allergy) => allergy.id)
    .map(mealAllergyRefOf);
}

export interface MealAllergyMismatch {
  /** 有効な食物アレルギーのうち、オーダーに写っていないもの。 */
  missing: fhir4.AllergyIntolerance[];
  /** オーダーに写っているが、有効な食物アレルギーではなくなったもの。 */
  stale: MealAllergyRef[];
}

/**
 * オーダー 1 件と、いま有効なアレルギー(useActiveAllergies が返す全件でよい)の突き合わせ。
 */
export function mealAllergyMismatch(
  carried: MealAllergyRef[],
  allergies: fhir4.AllergyIntolerance[],
): MealAllergyMismatch {
  const active = activeFoodAllergies(allergies).filter((allergy) => allergy.id);
  const carriedIds = new Set(carried.map((ref) => ref.id));
  const activeIds = new Set(active.map((allergy) => allergy.id as string));
  return {
    missing: active.filter((allergy) => !carriedIds.has(allergy.id as string)),
    stale: carried.filter((ref) => !activeIds.has(ref.id)),
  };
}

export function mealOrderAllergyMismatch(
  sr: fhir4.ServiceRequest,
  allergies: fhir4.AllergyIntolerance[],
): MealAllergyMismatch {
  return mealAllergyMismatch(mealOrderAllergies(sr), allergies);
}

export function hasMealAllergyMismatch(mismatch: MealAllergyMismatch): boolean {
  return mismatch.missing.length > 0 || mismatch.stale.length > 0;
}
