import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTransfusionProduct,
  deleteTransfusionProduct,
  fetchTransfusionProduct,
  searchTransfusionProducts,
  type TransfusionProductPayload,
  updateTransfusionProduct,
} from "../masterClient";

// ---- 輸血製剤マスタ ----
//
// 食事オーダーのマスタと同じ形。施設ごとに数十件で収まるので、オーダー画面の
// 選択肢は検索モーダルを作らず有効期間内の全件をまとめて引く。

const TRANSFUSION_PRODUCTS_KEY = ["master", "transfusion_products"];

export interface TransfusionProductFilters {
  name?: string;
  /** 製剤区分(rbc / ffp / plt / auto / other)。 */
  category?: string;
  active?: boolean;
}

export function useTransfusionProductSearch(
  filters: TransfusionProductFilters,
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...TRANSFUSION_PRODUCTS_KEY, "list", filters, page],
    queryFn: () =>
      searchTransfusionProducts({
        name: filters.name || undefined,
        category: filters.category || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useTransfusionProduct(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...TRANSFUSION_PRODUCTS_KEY, "detail", idOrCode],
    queryFn: () => fetchTransfusionProduct(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

/** オーダー画面の製剤の選択肢(有効期間内の全件)。 */
export function useTransfusionProductOptions() {
  return useQuery({
    queryKey: [...TRANSFUSION_PRODUCTS_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchTransfusionProducts({ active: true, per: 200 }),
  });
}

export function useTransfusionProductMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: TRANSFUSION_PRODUCTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: TransfusionProductPayload) => createTransfusionProduct(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: TransfusionProductPayload }) =>
        updateTransfusionProduct(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteTransfusionProduct(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
