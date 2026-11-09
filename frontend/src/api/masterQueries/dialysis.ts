import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createBloodPurifier,
  deleteBloodPurifier,
  fetchBloodPurifier,
  searchBloodPurifiers,
  updateBloodPurifier,
  type BloodPurifierPayload,
} from "../masterClient";

const BLOOD_PURIFIERS_KEY = ["master", "blood_purifiers"];

export interface BloodPurifierFilters {
  name?: string;
  maker?: string;
  kind?: string;
  /** 紐付けのないものだけ(算定できない製品の点検用)。 */
  unlinked?: boolean;
  active?: boolean;
}

/** 血液浄化器(施設マスタ)の検索。 */
export function useBloodPurifierSearch(filters: BloodPurifierFilters, page: number) {
  return useQuery({
    queryKey: [...BLOOD_PURIFIERS_KEY, "list", filters, page],
    queryFn: () =>
      searchBloodPurifiers({
        name: filters.name || undefined,
        maker: filters.maker || undefined,
        kind: filters.kind || undefined,
        unlinked: filters.unlinked || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
  });
}

/** 編集モーダル用の詳細。 */
export function useBloodPurifier(id: number | null) {
  return useQuery({
    queryKey: [...BLOOD_PURIFIERS_KEY, "detail", id],
    queryFn: () => fetchBloodPurifier(id as number),
    enabled: id !== null,
  });
}

export function useBloodPurifierMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: BLOOD_PURIFIERS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: BloodPurifierPayload) => createBloodPurifier(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: BloodPurifierPayload }) =>
        updateBloodPurifier(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteBloodPurifier(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
