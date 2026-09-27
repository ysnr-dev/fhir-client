import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMealCategory,
  createMealDiet,
  createMealItem,
  deleteMealCategory,
  deleteMealDiet,
  deleteMealItem,
  fetchMealDiet,
  fetchMealItem,
  type MealCategoryPayload,
  type MealDiet,
  type MealDietPayload,
  type MealItemPayload,
  searchMealCategories,
  searchMealDiets,
  searchMealItems,
  updateMealCategory,
  updateMealDiet,
  updateMealItem,
} from "../masterClient";
import type { MealItemRef } from "../../fhir/mealOrderHelpers";

// ---- 食事オーダーのマスタ ----
//
// 食種(MealDiet)と、主食(staple)・副食形態(side_dish_form)の項目(MealItem)は別テーブル。
// 食種は種別・食止め・主成分量を持つ実体、項目はコードと名称のリスト(docs/meal-order-design.md §3)。

const MEAL_DIETS_KEY = ["master", "meal_diets"];
const MEAL_ITEMS_KEY = ["master", "meal_items"];
const MEAL_CATEGORIES_KEY = ["master", "meal_categories"];

/** 食種の種別(分類)の検索(マスタ画面の一覧)。 */
export function useMealCategorySearch(
  filters: { name?: string; active?: boolean },
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...MEAL_CATEGORIES_KEY, "list", filters, page],
    queryFn: () =>
      searchMealCategories({
        name: filters.name || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * 種別の選択肢。食種マスタと食事オーダー画面が共通で使う。
 * 数件にしかならないマスタなので全件まとめて引く。
 */
export function useMealCategoryOptions() {
  return useQuery({
    queryKey: [...MEAL_CATEGORIES_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchMealCategories({ per: 100 }),
  });
}

export function useMealCategoryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: MEAL_CATEGORIES_KEY });
    // 分類を消すと食種側の種別も外れるので、食種の一覧・選択肢も引き直す。
    queryClient.invalidateQueries({ queryKey: MEAL_DIETS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: MealCategoryPayload) => createMealCategory(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MealCategoryPayload }) =>
        updateMealCategory(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMealCategory(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface MealDietFilters {
  name?: string;
  categoryCode?: string;
  active?: boolean;
}

export function useMealDietSearch(filters: MealDietFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...MEAL_DIETS_KEY, "list", filters, page],
    queryFn: () =>
      searchMealDiets({
        name: filters.name || undefined,
        category_code: filters.categoryCode || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMealDiet(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...MEAL_DIETS_KEY, "detail", idOrCode],
    queryFn: () => fetchMealDiet(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

/**
 * オーダー画面の食種選択(MealDietPickerModal)に出す食種。有効期間内の全件を 1 ページで
 * 引き、絞り込みはクライアント側で行う(施設で 100〜300 件程度)。
 */
export function useMealDietOptions() {
  return useQuery({
    queryKey: [...MEAL_DIETS_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchMealDiets({ active: true, per: 500 }),
  });
}

/**
 * 食止めの食種(is_fasting の先頭)。外出泊の連動が食止めオーダーを作るのに使う。
 * 登録が無ければ null(連動は食止めオーダーを省く)。
 */
export function fastingDietOf(diets: MealDiet[] | undefined): MealItemRef | null {
  const diet = diets?.find((d) => d.is_fasting);
  return diet ? { code: diet.item_code, name: diet.name } : null;
}

export async function fetchFastingDiet(): Promise<MealItemRef | null> {
  const result = await searchMealDiets({ active: true, per: 500 });
  return fastingDietOf(result.items);
}

export function useFastingDiet() {
  const diets = useMealDietOptions();
  return { ...diets, fastingDiet: fastingDietOf(diets.data?.items) };
}

/**
 * 食種コードのうち食止めのものだけを集める。経過表が「摂取量の枠を出さない食事」を
 * 判定するのに使う(食止めは食種の側の情報で、オーダーには焼いていない)。
 * 期間に出ている食種は数件なので、コードを指定して引く。
 */
export function useFastingDietCodes(itemCodes: string[]) {
  const sorted = [...new Set(itemCodes)].sort();
  return useQuery({
    queryKey: [...MEAL_DIETS_KEY, "fasting-codes", sorted.join(",")],
    queryFn: async () => {
      const result = await searchMealDiets({ item_code: sorted.join(","), per: 500 });
      return new Set(result.items.filter((d) => d.is_fasting).map((d) => d.item_code));
    },
    enabled: sorted.length > 0,
    staleTime: Infinity,
  });
}

export function useMealDietMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MEAL_DIETS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MealDietPayload) => createMealDiet(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MealDietPayload }) =>
        updateMealDiet(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMealDiet(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface MealItemFilters {
  name?: string;
  /** "staple"=主食 / "side_dish_form"=副食形態。 */
  kind?: string;
  active?: boolean;
}

export function useMealItemSearch(filters: MealItemFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...MEAL_ITEMS_KEY, "list", filters, page],
    queryFn: () =>
      searchMealItems({
        name: filters.name || undefined,
        kind: filters.kind || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMealItem(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...MEAL_ITEMS_KEY, "detail", idOrCode],
    queryFn: () => fetchMealItem(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

/**
 * オーダー画面の主食・副食形態の選択肢。施設ごとに数件〜十数件で収まるマスタなので、
 * 有効期間内の全件をまとめて引いてセレクトに並べる。
 */
export function useMealItemOptions(kind: "staple" | "side_dish_form") {
  return useQuery({
    queryKey: [...MEAL_ITEMS_KEY, "options", kind],
    staleTime: Infinity,
    queryFn: () => searchMealItems({ kind, active: true, per: 200 }),
  });
}

export function useMealItemMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MEAL_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MealItemPayload) => createMealItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MealItemPayload }) =>
        updateMealItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMealItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
