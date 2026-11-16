import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  buildIngredientIndex,
  EMPTY_INGREDIENT_INDEX,
  ruleIngredientCode,
  type IngredientIndex,
} from "../../fhir/ingredientIndex";
import { fetchAtcClasses, fetchMedicineIngredients } from "../masterClient";

// 成分マスタ。全件を読んで手元で引く。取込でしか変わらないので長く持つ。
const STALE_TIME = 60 * 60 * 1000;

export function useMedicineIngredients(enabled = true) {
  return useQuery({
    queryKey: ["master", "medicine_ingredients"],
    queryFn: fetchMedicineIngredients,
    staleTime: STALE_TIME,
    enabled,
  });
}

/** 成分マスタの索引。読み込み前と未取込のときは空(上 7 桁での照合だけになる)。 */
export function useIngredientIndex(enabled = true): IngredientIndex {
  const { data } = useMedicineIngredients(enabled);
  return useMemo(() => (data ? buildIngredientIndex(data) : EMPTY_INGREDIENT_INDEX), [data]);
}

/** ATC 分類(2〜4 階層目)の名称。規則の登録画面で群を選ぶ候補。 */
export function useAtcClasses() {
  return useQuery({ queryKey: ["master", "atc_classes"], queryFn: fetchAtcClasses, staleTime: STALE_TIME });
}

/** 候補から選ぶ薬の群(ATC 分類・成分)。`text` は候補に出す文字列。 */
export interface DrugClassOption {
  code: string;
  name: string;
  text: string;
}

/** ATC 分類の候補に添える成分名の数。 */
const ATC_MEMBER_NAMES = 4;

/**
 * ATC 分類の候補("C10AA HMG CoA reductase inhibitors（アトルバスタチン・…）")。分類名は英語なので、
 * 属する成分の名前を添える。
 */
export function useAtcClassOptions(): DrugClassOption[] {
  const classes = useAtcClasses();
  const ingredients = useMedicineIngredients();
  return useMemo(() => {
    const names = new Map<string, Set<string>>();
    for (const row of ingredients.data ?? []) {
      if (!row.name_ja) continue;
      for (const atc of row.atc_codes) {
        for (const length of [3, 4, 5]) {
          const prefix = atc.slice(0, length);
          names.set(prefix, (names.get(prefix) ?? new Set()).add(row.name_ja));
        }
      }
    }
    return (classes.data ?? []).map((atcClass) => {
      const members = [...(names.get(atcClass.code) ?? [])];
      const shown = members.slice(0, ATC_MEMBER_NAMES).join("・");
      const suffix = members.length > ATC_MEMBER_NAMES ? "…" : "";
      return { ...atcClass, text: `${atcClass.code} ${atcClass.name}${shown ? `（${shown}${suffix}）` : ""}` };
    });
  }, [classes.data, ingredients.data]);
}

/** 成分の候補("アスピリン（aspirin）")。コードは規則と同じ書き方(`I` + 成分の ID)。名前の順。 */
export function useIngredientOptions(): DrugClassOption[] {
  const ingredients = useMedicineIngredients();
  return useMemo(() => {
    const options = new Map<number, DrugClassOption>();
    for (const row of ingredients.data ?? []) {
      if (options.has(row.ingredient_id)) continue;
      options.set(row.ingredient_id, {
        code: ruleIngredientCode(row.ingredient_id),
        name: row.name_ja ?? row.name,
        text: row.name_ja ? `${row.name_ja}（${row.name}）` : row.name,
      });
    }
    return [...options.values()].sort((a, b) => a.text.localeCompare(b.text, "ja"));
  }, [ingredients.data]);
}
