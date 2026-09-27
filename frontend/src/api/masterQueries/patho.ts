import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPathoCollectionMethod,
  createPathoOrgan,
  deletePathoCollectionMethod,
  deletePathoOrgan,
  fetchPathoCollectionMethods,
  type PathoCollectionMethodPayload,
  type PathoOrganPayload,
  searchPathoOrgans,
  updatePathoCollectionMethod,
  updatePathoOrgan,
} from "../masterClient";

// ---- 病理検査オーダーのマスタ ----

const PATHO_ORGANS_KEY = ["master", "patho_organs"];
const PATHO_COLLECTION_METHODS_KEY = ["master", "patho_collection_methods"];

export interface PathoOrganFilters {
  name?: string;
  frequent?: boolean;
  source?: string;
}

export function usePathoOrganSearch(filters: PathoOrganFilters, page: number) {
  return useQuery({
    queryKey: [...PATHO_ORGANS_KEY, "list", filters, page],
    queryFn: () =>
      searchPathoOrgans({
        name: filters.name || undefined,
        frequent: filters.frequent || undefined,
        source: filters.source || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
  });
}

export function usePathoOrganMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PATHO_ORGANS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: PathoOrganPayload) => createPathoOrgan(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PathoOrganPayload }) =>
        updatePathoOrgan(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePathoOrgan(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 病理検査オーダー画面用: 頻用臓器(検索する前に並べる候補)。
export function useFrequentPathoOrgans() {
  return useQuery({
    queryKey: [...PATHO_ORGANS_KEY, "frequent"],
    queryFn: () => searchPathoOrgans({ frequent: true, per: 100 }),
  });
}

export function usePathoCollectionMethods() {
  return useQuery({
    queryKey: [...PATHO_COLLECTION_METHODS_KEY, "list"],
    staleTime: Infinity,
    queryFn: fetchPathoCollectionMethods,
  });
}

export function usePathoCollectionMethodMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: PATHO_COLLECTION_METHODS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: PathoCollectionMethodPayload) => createPathoCollectionMethod(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PathoCollectionMethodPayload }) =>
        updatePathoCollectionMethod(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePathoCollectionMethod(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
