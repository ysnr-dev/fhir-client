/**
 * 投与量の単位換算(力価 ⇔ 製剤数 ⇔ 容量)。
 *
 * 化学療法レジメンから出たオーダーは投与量を**力価**(148.75 mg)で持つ(指示の実体が
 * 力価のため。docs/chemo-regimen-design.md §7.2)。一方、手入力の注射・処方は製剤数
 * (1 瓶・2 錠)で持つ。読む側は `doseQuantity.unit` を尊重するので混在しても壊れないが、
 * **払出(MedicationDispense)は製剤数で出す**ので、力価のオーダーを払い出すときは
 * 投与量換算マスタ(`master_medicine_dose_conversions`)で製剤数に直す。
 * 注射の総投与量・経過表の水分出納のように **mL に揃える**ところも、単位を見ずに
 * 「製剤数 × 1 製剤の mL」と掛けると力価のオーダーで桁違いになるので `toMilliliters` を通す。
 */

const ML_UNIT = "mL";

/**
 * オーダー・実施記録の投与量を容量(mL)に直す。注射の総投与量(投与速度の算出)と
 * 経過表の水分出納が使う。
 * - 単位が mL ならそのまま(容量で指示した補液)
 * - 単位が換算マスタの力価の単位(mg など)なら 力価 ÷ 力価の係数 = 製剤数 に直してから mL にする
 * - それ以外(空・薬価算定単位・換算マスタに無い表記)は製剤数とみなし 製剤数 × 1 製剤の mL
 *   (手入力の注射は薬価算定単位で入れる。医薬品マスタと換算マスタで単位の表記が違っても
 *   製剤数として数える)
 * - mL の換算行が無ければ null(呼び手は「換算できない」件数に数える)
 */
export function toMilliliters(
  dose: number,
  unit: string | null | undefined,
  medicineCode: string,
  conversions: MedicineDoseConversionMap | undefined,
): number | null {
  const normalized = (unit ?? "").trim();
  if (normalized.toLowerCase() === ML_UNIT.toLowerCase()) return dose;
  const byUnit = conversions?.factors.get(medicineCode);
  const mlPerPack = byUnit?.get(ML_UNIT);
  if (!mlPerPack) return null;
  const packUnit = conversions?.packUnits.get(medicineCode);
  const factor = normalized && normalized !== packUnit ? byUnit?.get(normalized) : undefined;
  if (factor) return (dose / factor) * mlPerPack;
  return dose * mlPerPack;
}

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
