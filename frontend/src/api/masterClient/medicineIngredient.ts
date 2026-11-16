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
}

export async function fetchMedicineIngredients(): Promise<MedicineIngredient[]> {
  const res = await masterFetch("/master/medicine_ingredients");
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MedicineIngredient[];
}
