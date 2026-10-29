import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createManagementFeeItem,
  deleteManagementFeeItem,
  type ManagementFeeItemPayload,
  searchManagementFeeItems,
  updateManagementFeeItem,
} from "../masterClient";

// ---- 指導・管理料の項目マスタ ----

const MANAGEMENT_FEE_ITEMS_KEY = ["master", "management_fee_items"];

/**
 * 項目の一覧。施設が登録する数十件程度のものなので 1 ページで全件を引く。
 * active・setting を渡すとオーダーで選べる項目だけになる。
 */
export function useManagementFeeItems(filters: { active?: boolean; setting?: string } = {}) {
  return useQuery({
    queryKey: [...MANAGEMENT_FEE_ITEMS_KEY, "list", filters],
    queryFn: () =>
      searchManagementFeeItems({
        active: filters.active || undefined,
        setting: filters.setting || undefined,
        per: 500,
      }),
  });
}

export function useManagementFeeItemMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MANAGEMENT_FEE_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: ManagementFeeItemPayload) => createManagementFeeItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: ManagementFeeItemPayload }) =>
        updateManagementFeeItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteManagementFeeItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
