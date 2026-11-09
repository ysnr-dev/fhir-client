// 血液浄化器(施設マスタ `master_blood_purifiers`)の種別と、オーダーに焼き付ける名前。
//
// 製品名だけでは指示にならないので、オーダーには膜素材と膜面積まで含めた名前を残す。
// 種別のコードは backend の Master::BloodPurifier::KINDS と同じ。

import type { DialysisModality } from "./dialysisOrderHelpers";

export const BLOOD_PURIFIER_KIND_OPTIONS = [
  { code: "dialyzer", display: "ダイアライザ" },
  { code: "hemodiafilter", display: "ヘモダイアフィルタ" },
  { code: "hemofilter", display: "ヘモフィルタ" },
  { code: "continuous_filter", display: "持続緩徐式血液濾過器" },
  { code: "plasma_separator", display: "血漿分離器" },
  { code: "plasma_component_separator", display: "血漿成分分離器" },
  { code: "adsorber", display: "吸着器" },
] as const;

export type BloodPurifierKind = (typeof BLOOD_PURIFIER_KIND_OPTIONS)[number]["code"];

/** 浄化方法ごとに使う種別。DFPP は血漿分離器と血漿成分分離器の 2 本を使う。 */
const KINDS_BY_MODALITY: Record<DialysisModality, readonly BloodPurifierKind[]> = {
  hd: ["dialyzer"],
  hdf: ["hemodiafilter"],
  "i-hdf": ["hemodiafilter"],
  chdf: ["continuous_filter"],
  chd: ["continuous_filter"],
  pe: ["plasma_separator"],
  dfpp: ["plasma_separator", "plasma_component_separator"],
  dhp: ["adsorber"],
};

/** 入力行の検索の初期種別。行が浄化方法の定義より多いときと浄化方法が未選択のときは絞らない。 */
export function bloodPurifierKindForRow(modality: DialysisModality | "", row: number): BloodPurifierKind | "" {
  if (!modality) return "";
  return KINDS_BY_MODALITY[modality][row] ?? "";
}

/** 浄化方法が使う本数。浄化方法が未選択でも入力行を 1 つ出す。 */
export function bloodPurifierRowCount(modality: DialysisModality | ""): number {
  return modality ? KINDS_BY_MODALITY[modality].length : 1;
}

export function bloodPurifierKindDisplay(kind: string): string {
  return BLOOD_PURIFIER_KIND_OPTIONS.find((option) => option.code === kind)?.display ?? kind;
}

interface PurifierMembrane {
  membrane_material: string | null;
  membrane_area: string | null;
}

/** 「PS 1.5㎡」。 */
export function bloodPurifierMembraneLabel(purifier: PurifierMembrane): string {
  const area = purifier.membrane_area ? `${Number(purifier.membrane_area)}㎡` : "";
  return [purifier.membrane_material, area].filter(Boolean).join(" ");
}

/** 「製品A(PS 1.5㎡)」。膜の情報が無ければ製品名だけ。 */
export function bloodPurifierLabel(purifier: PurifierMembrane & { name: string }): string {
  const membrane = bloodPurifierMembraneLabel(purifier);
  return membrane ? `${purifier.name}(${membrane})` : purifier.name;
}
