import type { Medicine } from "../api/masterClient";

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

/**
 * 投与量を任意の単位に直す。薬剤チェックの用量上限(mg/日 など)と比べるのに使う。
 * いったん製剤数に直し(単位が薬価算定単位か空ならそのまま)、目的の単位の係数を掛ける。
 * 換算行が足りなければ null。
 */
export function convertDose(
  dose: number,
  unit: string | null | undefined,
  medicineCode: string,
  targetUnit: string,
  conversions: MedicineDoseConversionMap | undefined,
): number | null {
  const from = (unit ?? "").trim();
  const to = targetUnit.trim();
  if (from === to) return dose;

  const byUnit = conversions?.factors.get(medicineCode);
  const packUnit = conversions?.packUnits.get(medicineCode);
  if (!packUnit) return null;

  let packs: number;
  if (!from || from === packUnit) {
    packs = dose;
  } else {
    const fromFactor = byUnit?.get(from);
    if (!fromFactor) return null;
    packs = dose / fromFactor;
  }

  if (to === packUnit) return packs;
  const toFactor = byUnit?.get(to);
  return toFactor ? packs * toFactor : null;
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

/** 薬価算定単位のほかに選べる量の単位の種類。力価(mg・単位…)か、製剤の容量(mL)。 */
export type DoseUnitKind = "potency" | "volume";

/**
 * 処方・注射の用量に選べる単位。`units` は単位 → 1 [薬価算定単位] あたりの量と種類。
 * 換算マスタの行のうち、薬価算定単位と同じ単位(全角半角違い)の行は入らない。
 */
export interface DoseUnits {
  packUnit: string;
  units: Map<string, { factor: number; kind: DoseUnitKind }>;
}

/** 換算行の単位の種類。薬価算定単位と同じ単位(g → ｇ。薬価算定単位が量そのもの)なら null。 */
export function doseUnitKind(fromUnit: string, toUnit: string): DoseUnitKind | null {
  const from = fromUnit.normalize("NFKC").trim();
  if (from === toUnit.normalize("NFKC").trim()) return null;
  return from.toLowerCase() === ML_UNIT.toLowerCase() ? "volume" : "potency";
}

/** 力価の単位への換算行か。容量(mL)と薬価算定単位そのものは力価ではない。 */
export function isPotencyConversion(fromUnit: string, toUnit: string): boolean {
  return doseUnitKind(fromUnit, toUnit) === "potency";
}

/** 単位の選択肢。薬価算定単位を先頭に、力価は「(力価)」、容量は「(容量)」を添える。 */
export function doseUnitOptions(
  doseUnits: DoseUnits,
  current: string | null,
  { volume }: { volume: boolean },
): { unit: string; label: string }[] {
  const options = [{ unit: doseUnits.packUnit, label: doseUnits.packUnit }];
  for (const [unit, { kind }] of doseUnits.units) {
    if (kind === "potency") options.push({ unit, label: `${unit}(力価)` });
    else if (volume) options.push({ unit, label: `${unit}(容量)` });
  }
  // 換算マスタに無い単位で保存された行も、そのまま選ばれた状態で開く。
  if (current && !options.some((o) => o.unit === current)) options.push({ unit: current, label: current });
  return options;
}

/** 薬価算定単位のほかに選べる単位があるか(単位をセレクトにするかの判定)。 */
export function hasDoseUnitChoice(doseUnits: DoseUnits | undefined, { volume }: { volume: boolean }): boolean {
  return Array.from(doseUnits?.units.values() ?? []).some((u) => u.kind === "potency" || volume);
}

/**
 * 単位を切り替えたときの用量。薬価算定単位を介して係数で行き来する。
 * 空・不正な値と、換算できない単位はそのまま返す。
 */
export function convertDoseUnit(dose: string, from: string, to: string, doseUnits: DoseUnits): string {
  const value = Number(dose);
  if (dose.trim() === "" || !Number.isFinite(value) || from === to) return dose;
  const factorOf = (unit: string) => (unit === doseUnits.packUnit ? 1 : (doseUnits.units.get(unit)?.factor ?? NaN));
  const converted = (value / factorOf(from)) * factorOf(to);
  if (!Number.isFinite(converted)) return dose;
  return String(Math.round(converted * 1000) / 1000);
}

/**
 * 薬剤行の単位を切り替える差分。入力済みの用量(不均等の各回も)を換算し、
 * 力価の単位なら `potency` を立てる(`doseAndRate.type` の原薬量になる)。
 */
export function switchDoseUnit<L extends { medicine: Medicine | null; dose: string; unevenDoses?: string[] | null }>(
  line: L,
  unit: string,
  doseUnits: DoseUnits,
): Partial<L> & { potency: boolean } {
  if (!line.medicine) return { potency: false } as Partial<L> & { potency: boolean };
  const from = line.medicine.unit_name ?? doseUnits.packUnit;
  const convert = (dose: string) => convertDoseUnit(dose, from, unit, doseUnits);
  return {
    medicine: { ...line.medicine, unit_name: unit },
    potency: doseUnits.units.get(unit)?.kind === "potency",
    dose: convert(line.dose),
    ...(line.unevenDoses ? { unevenDoses: line.unevenDoses.map(convert) } : {}),
  } as Partial<L> & { potency: boolean };
}
