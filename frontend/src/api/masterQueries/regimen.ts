import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  copyRegimen,
  createRegimen,
  deleteRegimen,
  fetchRegimen,
  type RegimenPayload,
  type RegimenSearchParams,
  searchRegimens,
  updateRegimen,
} from "../masterClient";

// ---- 化学療法レジメンマスタ ----

const REGIMENS_KEY = ["master", "regimens"];

export function useRegimenSearch(filters: Omit<RegimenSearchParams, "page" | "per">, page: number) {
  return useQuery({
    queryKey: [...REGIMENS_KEY, "list", filters, page],
    queryFn: () => searchRegimens({ ...filters, page, per: 20 }),
    placeholderData: keepPreviousData,
  });
}

export function useRegimen(idOrCode: number | string | null) {
  return useQuery({
    queryKey: [...REGIMENS_KEY, "detail", idOrCode],
    queryFn: () => fetchRegimen(idOrCode as number | string),
    enabled: idOrCode !== null,
    // 存在しない id を開いたときに再試行で「読み込み中」を引き延ばさない。
    retry: false,
  });
}

export function useRegimenMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: REGIMENS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: RegimenPayload) => createRegimen(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: RegimenPayload }) => updateRegimen(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    copy: useMutation({
      mutationFn: ({ id, name }: { id: number; name?: string }) => copyRegimen(id, name),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRegimen(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

/** 適用の候補にするレジメン(承認済かつ有効期間内)。 */
export function useApplicableRegimens(name: string) {
  return useQuery({
    queryKey: [...REGIMENS_KEY, "applicable", name],
    queryFn: () => searchRegimens({ name, status: "approved", active: true, per: 100 }),
    placeholderData: keepPreviousData,
  });
}
