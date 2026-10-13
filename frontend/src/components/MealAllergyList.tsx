import { summarizeAllergy } from "../fhir/allergyHelpers";
import { activeFoodAllergies, type MealAllergyMismatch } from "../fhir/mealAllergyHelpers";

/**
 * 食事オーダーの画面に出す食物アレルギーの一覧。表示だけで、保存時にそのままオーダーへ写る。
 * 編集で開いたときは、開いたオーダーの写しと比べて「未反映」(オーダーに無い)と
 * 「解消済み」(オーダーにあるが有効でなくなった)の印を付ける。
 */
export function MealAllergyList({
  allergies,
  mismatch,
}: {
  allergies: fhir4.AllergyIntolerance[];
  mismatch: MealAllergyMismatch;
}) {
  const food = activeFoodAllergies(allergies);
  const missingIds = new Set(mismatch.missing.map((allergy) => allergy.id));

  if (food.length === 0 && mismatch.stale.length === 0) {
    return <p className="meal-allergy-list__empty">なし</p>;
  }

  return (
    <ul className="meal-allergy-list">
      {food.map((allergy) => {
        const summary = summarizeAllergy(allergy);
        return (
          <li key={summary.id} className="meal-allergy-list__row">
            <span className="meal-allergy-list__name">{summary.name}</span>
            {summary.criticalityLabel && (
              <span
                className={`meal-allergy-list__criticality${
                  allergy.criticality === "high" ? " meal-allergy-list__criticality--high" : ""
                }`}
              >
                重篤化リスク {summary.criticalityLabel}
              </span>
            )}
            {summary.reaction && <span className="meal-allergy-list__reaction">{summary.reaction}</span>}
            {missingIds.has(allergy.id) && (
              <span className="meal-allergy-list__badge meal-allergy-list__badge--missing">未反映</span>
            )}
          </li>
        );
      })}
      {mismatch.stale.map((ref) => (
        <li key={ref.id} className="meal-allergy-list__row meal-allergy-list__row--stale">
          <span className="meal-allergy-list__name">{ref.name || ref.id}</span>
          <span className="meal-allergy-list__badge meal-allergy-list__badge--stale">解消済み</span>
        </li>
      ))}
    </ul>
  );
}
