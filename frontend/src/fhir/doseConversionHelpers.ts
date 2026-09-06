/**
 * 投与量の単位換算(力価 ⇔ 製剤数)。
 *
 * 化学療法レジメンから出たオーダーは投与量を**力価**(148.75 mg)で持つ(指示の実体が
 * 力価のため。docs/chemo-regimen-design.md §7.2)。一方、手入力の注射・処方は製剤数
 * (1 瓶・2 錠)で持つ。読む側は `doseQuantity.unit` を尊重するので混在しても壊れないが、
 * **払出(MedicationDispense)は製剤数で出す**ので、力価のオーダーを払い出すときは
 * 投与量換算マスタ(`master_medicine_dose_conversions`)で製剤数に直す。
 */

export interface MedicineDoseConversionMap {
  /** 薬剤コード → 力価の単位 → 1 [薬価算定単位] あたりの力価。 */
  factors: Map<string, Map<string, number>>;
  /** 薬剤コード → 薬価算定単位(換算行の to_unit)。換算行が無い薬剤は入らない。 */
  packUnits: Map<string, string>;
}

export interface PackQuantity {
  value: number;
  unit: string;
}

/**
 * オーダーの投与量を製剤数(薬価算定単位)に直す。
 * - 換算行が無い薬剤、または単位が薬価算定単位そのもの(製剤数で出したオーダー)なら、そのまま返す
 * - 単位が違い、換算があれば 力価 ÷ 係数
 * - 単位が違い、換算が無ければ null(手入力してもらう)
 */
export function toPackQuantity(
  dose: number,
  unit: string,
  medicineCode: string,
  conversions: MedicineDoseConversionMap | undefined,
): PackQuantity | null {
  const packUnit = conversions?.packUnits.get(medicineCode);
  if (!packUnit || !unit || unit === packUnit) return { value: dose, unit };
  const factor = conversions?.factors.get(medicineCode)?.get(unit);
  if (!factor) return null;
  return { value: Math.round((dose / factor) * 100) / 100, unit: packUnit };
}
