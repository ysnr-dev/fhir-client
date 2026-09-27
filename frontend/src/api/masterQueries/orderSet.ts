import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  copyOrderSet,
  createOrderSet,
  deleteOrderSet,
  fetchOrderSet,
  fetchOrderSets,
  type OrderSetCopyPayload,
  type OrderSetEntryPayload,
  type OrderSetPayload,
  replaceOrderSetEntries,
  updateOrderSet,
} from "../masterClient";

// ---- オーダーセット ----

const ORDER_SETS_KEY = ["master", "order_sets"];

// ツリーは持ち主の組(院内共通 + 診療科 X + 医師 Y)ごとにキャッシュする。カルテ
// (代行入力)はヘッダーで選んだ依頼科・指示医師で、登録画面はログイン本人で引く。
export function useOrderSets(departmentId: string | undefined, practitionerId: string | undefined) {
  return useQuery({
    queryKey: [
      ...ORDER_SETS_KEY,
      "tree",
      { departmentId: departmentId ?? "", practitionerId: practitionerId ?? "" },
    ],
    queryFn: () => fetchOrderSets({ department_id: departmentId, practitioner_id: practitionerId }),
  });
}

export function useOrderSet(id: number | undefined) {
  return useQuery({
    queryKey: [...ORDER_SETS_KEY, "detail", id],
    queryFn: () => fetchOrderSet(id as number),
    enabled: Boolean(id),
  });
}

export function useOrderSetMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ORDER_SETS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: OrderSetPayload) => createOrderSet(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: OrderSetPayload }) =>
        updateOrderSet(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    replaceEntries: useMutation({
      mutationFn: ({ id, entries }: { id: number; entries: OrderSetEntryPayload[] }) =>
        replaceOrderSetEntries(id, entries),
      retry: false,
      onSuccess: invalidate,
    }),
    copy: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: OrderSetCopyPayload }) =>
        copyOrderSet(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteOrderSet(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
