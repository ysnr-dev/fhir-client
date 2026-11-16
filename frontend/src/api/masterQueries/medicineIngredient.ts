import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildIngredientIndex, EMPTY_INGREDIENT_INDEX, type IngredientIndex } from "../../fhir/ingredientIndex";
import { fetchMedicineIngredients } from "../masterClient";

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
