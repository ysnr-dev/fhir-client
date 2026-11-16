import { buildError, masterFetch } from "./core";

// 成分マスタ(コードの上 7 桁・上 9 桁 → 成分)。docs/drug-check-master-design.md

export interface MedicineIngredient {
  /** YJ コード・薬価基準コードの上 7 桁。規格で成分が変わる薬だけ上 9 桁。 */
  code_prefix: string;
  ingredient_id: number;
  /** 成分名(英)。 */
  name: string;
  /** 成分名(日)。配合剤にしか出ない成分は null。 */
  name_ja: string | null;
  /** その成分が主成分の ATC コード(5 階層目)。 */
  atc_codes: string[];
  /** 1 薬価単位(錠・カプセル)あたりの量。配合剤で分かっているものだけ。 */
  amount: number | null;
  amount_unit: string | null;
}

/** ATC 分類(2〜4 階層目)。 */
export interface AtcClass {
  code: string;
  name: string;
}

export async function fetchMedicineIngredients(): Promise<MedicineIngredient[]> {
  const res = await masterFetch("/master/medicine_ingredients");
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MedicineIngredient[];
}

export async function fetchAtcClasses(): Promise<AtcClass[]> {
  const res = await masterFetch("/master/atc_classes");
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as AtcClass[];
}
