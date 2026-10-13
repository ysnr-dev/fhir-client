import type { MealAllergyCheckRow } from "../../fhir/mealAllergyTaskHelpers";

/** 食事のアレルギー確認の内容セル。どのアレルギーがどの食事オーダーに未反映か。 */
export function MealAllergyCheckNotificationCells({ row }: { row: MealAllergyCheckRow }) {
  return (
    <>
      <td className="notification__compact">{row.startDate || "-"}</td>
      <td>
        <span className="notification__review-kind">食事</span>
        食物アレルギー「{row.allergyName}」が {row.orderLabel || "食事オーダー"} に反映されていません
      </td>
    </>
  );
}
