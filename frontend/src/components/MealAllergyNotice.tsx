import { useActiveAllergies, usePatientMealOrders } from "../api/queries";
import { summarizeAllergy } from "../fhir/allergyHelpers";
import { mealOrderAllergyMismatch } from "../fhir/mealAllergyHelpers";
import { mealOrderShortLabel } from "../fhir/mealAllergyTaskHelpers";
import { mealOrderServesOnOrAfter } from "../fhir/mealOrderHelpers";
import { today } from "../lib/dates";

/** 1 行に並べるオーダーの数。超えたぶんは「ほか N 件」。 */
const ORDERS_PER_LINE = 2;

/**
 * 食事タブの上に出す、進行中の食事オーダーと食物アレルギーの食い違い。
 * 有効な食物アレルギーがオーダーに写っていない(未反映)か、写してあるアレルギーが
 * 有効でなくなった(解消済み)ときだけ出す。どちらも無ければ何も出さない。
 * 同じアレルギーが複数のオーダーで未反映なら(パターン食の展開後など)1 行にまとめる。
 */
export function MealAllergyNotice({ patientId }: { patientId: string }) {
  const orders = usePatientMealOrders(patientId);
  const { allergies } = useActiveAllergies(patientId);

  const day = today();
  const running = (orders.data ?? [])
    .filter((sr) => mealOrderServesOnOrAfter(sr, day))
    .sort((a, b) => (a.occurrenceDateTime ?? "").localeCompare(b.occurrenceDateTime ?? ""));
  const missingBy = new Map<string, string[]>();
  const staleBy = new Map<string, string[]>();
  for (const sr of running) {
    const mismatch = mealOrderAllergyMismatch(sr, allergies);
    const label = mealOrderShortLabel(sr);
    if (mismatch.missing.length > 0) {
      const names = mismatch.missing.map((allergy) => summarizeAllergy(allergy).name).join("、");
      missingBy.set(names, [...(missingBy.get(names) ?? []), label]);
    }
    if (mismatch.stale.length > 0) {
      const names = mismatch.stale.map((ref) => ref.name || ref.id).join("、");
      staleBy.set(names, [...(staleBy.get(names) ?? []), label]);
    }
  }

  const lines = [
    ...[...missingBy].map(
      ([names, labels]) =>
        `食物アレルギー「${names}」が食事オーダー(${ordersText(labels)})に反映されていません`,
    ),
    ...[...staleBy].map(
      ([names, labels]) =>
        `食事オーダー(${ordersText(labels)})に写してある「${names}」は有効なアレルギーではなくなっています`,
    ),
  ];

  if (lines.length === 0) return null;
  return (
    <ul className="rad-safety-notice" role="note">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function ordersText(labels: string[]): string {
  const shown = labels.slice(0, ORDERS_PER_LINE).join("、");
  const rest = labels.length - ORDERS_PER_LINE;
  return rest > 0 ? `${shown} ほか ${rest} 件` : shown;
}
