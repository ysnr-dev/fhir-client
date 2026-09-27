import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMicroAntimicrobial,
  createMicroCollectionMethod,
  createMicroCollectionSite,
  createMicroOrderItem,
  createMicroOrganism,
  createMicroSpecimenType,
  createMicroSusceptibilityMethod,
  deleteMicroAntimicrobial,
  deleteMicroCollectionMethod,
  deleteMicroCollectionSite,
  deleteMicroOrderItem,
  deleteMicroOrganism,
  deleteMicroSpecimenType,
  deleteMicroSusceptibilityMethod,
  fetchMicroCollectionMethods,
  fetchMicroCollectionSites,
  fetchMicroOrderItems,
  type MicroAntimicrobialPayload,
  type MicroCollectionMethodPayload,
  type MicroCollectionSitePayload,
  type MicroOrderItemPayload,
  type MicroOrganismPayload,
  type MicroSpecimenTypePayload,
  type MicroSusceptibilityMethodPayload,
  searchMicroAntimicrobials,
  searchMicroOrganisms,
  searchMicroSpecimenTypes,
  searchMicroSusceptibilityMethods,
  updateMicroAntimicrobial,
  updateMicroCollectionMethod,
  updateMicroCollectionSite,
  updateMicroOrderItem,
  updateMicroOrganism,
  updateMicroSpecimenType,
  updateMicroSusceptibilityMethod,
} from "../masterClient";

// ---- 細菌検査(微生物検査)オーダーのマスタ ----

const MICRO_ORGANISMS_KEY = ["master", "micro_organisms"];
const MICRO_SPECIMEN_TYPES_KEY = ["master", "micro_specimen_types"];
const MICRO_ORDER_ITEMS_KEY = ["master", "micro_order_items"];
const MICRO_COLLECTION_SITES_KEY = ["master", "micro_collection_sites"];
const MICRO_COLLECTION_METHODS_KEY = ["master", "micro_collection_methods"];

export interface MicroOrganismFilters {
  name?: string;
  frequent?: boolean;
  source?: string;
}

export function useMicroOrganismSearch(filters: MicroOrganismFilters, page: number) {
  return useQuery({
    queryKey: [...MICRO_ORGANISMS_KEY, "list", filters, page],
    queryFn: () =>
      searchMicroOrganisms({
        name: filters.name || undefined,
        frequent: filters.frequent || undefined,
        source: filters.source || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useMicroOrganismMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MICRO_ORGANISMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroOrganismPayload) => createMicroOrganism(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroOrganismPayload }) =>
        updateMicroOrganism(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroOrganism(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface MicroSpecimenTypeFilters {
  name?: string;
  source?: string;
}

export function useMicroSpecimenTypeSearch(filters: MicroSpecimenTypeFilters, page: number) {
  return useQuery({
    queryKey: [...MICRO_SPECIMEN_TYPES_KEY, "list", filters, page],
    queryFn: () =>
      searchMicroSpecimenTypes({
        name: filters.name || undefined,
        source: filters.source || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useMicroSpecimenTypeMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MICRO_SPECIMEN_TYPES_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroSpecimenTypePayload) => createMicroSpecimenType(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroSpecimenTypePayload }) =>
        updateMicroSpecimenType(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroSpecimenType(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useMicroOrderItems() {
  return useQuery({
    queryKey: [...MICRO_ORDER_ITEMS_KEY, "list"],
    staleTime: Infinity,
    queryFn: fetchMicroOrderItems,
  });
}

export function useMicroOrderItemMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MICRO_ORDER_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroOrderItemPayload) => createMicroOrderItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroOrderItemPayload }) =>
        updateMicroOrderItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroOrderItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useMicroCollectionSites() {
  return useQuery({
    queryKey: [...MICRO_COLLECTION_SITES_KEY, "list"],
    staleTime: Infinity,
    queryFn: fetchMicroCollectionSites,
  });
}

export function useMicroCollectionSiteMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MICRO_COLLECTION_SITES_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroCollectionSitePayload) => createMicroCollectionSite(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroCollectionSitePayload }) =>
        updateMicroCollectionSite(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroCollectionSite(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useMicroCollectionMethods() {
  return useQuery({
    queryKey: [...MICRO_COLLECTION_METHODS_KEY, "list"],
    staleTime: Infinity,
    queryFn: fetchMicroCollectionMethods,
  });
}

export function useMicroCollectionMethodMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: MICRO_COLLECTION_METHODS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroCollectionMethodPayload) => createMicroCollectionMethod(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroCollectionMethodPayload }) =>
        updateMicroCollectionMethod(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroCollectionMethod(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 細菌検査オーダー画面用: 検体種別の選択肢(全件。標準50件+施設追加の想定)。
export function useMicroSpecimenTypeOptions() {
  return useQuery({
    queryKey: [...MICRO_SPECIMEN_TYPES_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchMicroSpecimenTypes({ per: 100 }),
  });
}

// 細菌検査オーダー画面用: 頻用菌(オーダー画面に直接並べる目的菌)の一覧。
export function useFrequentMicroOrganisms() {
  return useQuery({
    queryKey: [...MICRO_ORGANISMS_KEY, "frequent"],
    queryFn: () => searchMicroOrganisms({ frequent: true, per: 100 }),
  });
}

// ---- 細菌検査結果のマスタ ----

const MICRO_ANTIMICROBIALS_KEY = ["master", "micro_antimicrobials"];
const MICRO_SUSCEPTIBILITY_METHODS_KEY = ["master", "micro_susceptibility_methods"];

export interface MicroAntimicrobialFilters {
  name?: string;
  frequent?: boolean;
  source?: string;
}

export function useMicroAntimicrobialSearch(filters: MicroAntimicrobialFilters, page: number) {
  return useQuery({
    queryKey: [...MICRO_ANTIMICROBIALS_KEY, "list", filters, page],
    queryFn: () =>
      searchMicroAntimicrobials({
        name: filters.name || undefined,
        frequent: filters.frequent || undefined,
        source: filters.source || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useMicroAntimicrobialMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MICRO_ANTIMICROBIALS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroAntimicrobialPayload) => createMicroAntimicrobial(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroAntimicrobialPayload }) =>
        updateMicroAntimicrobial(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroAntimicrobial(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface MicroSusceptibilityMethodFilters {
  name?: string;
  source?: string;
}

export function useMicroSusceptibilityMethodSearch(
  filters: MicroSusceptibilityMethodFilters,
  page: number,
) {
  return useQuery({
    queryKey: [...MICRO_SUSCEPTIBILITY_METHODS_KEY, "list", filters, page],
    queryFn: () =>
      searchMicroSusceptibilityMethods({
        name: filters.name || undefined,
        source: filters.source || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useMicroSusceptibilityMethodMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: MICRO_SUSCEPTIBILITY_METHODS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroSusceptibilityMethodPayload) =>
        createMicroSusceptibilityMethod(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroSusceptibilityMethodPayload }) =>
        updateMicroSusceptibilityMethod(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroSusceptibilityMethod(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 細菌検査結果画面用: 頻用抗菌薬(感受性欄に直接並べる薬)の一覧。
export function useFrequentMicroAntimicrobials() {
  return useQuery({
    queryKey: [...MICRO_ANTIMICROBIALS_KEY, "frequent"],
    queryFn: () => searchMicroAntimicrobials({ frequent: true, per: 100 }),
  });
}

// 細菌検査結果画面用: 感受性測定法の選択肢(全件。標準33件+施設追加の想定)。
export function useMicroSusceptibilityMethodOptions() {
  return useQuery({
    queryKey: [...MICRO_SUSCEPTIBILITY_METHODS_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchMicroSusceptibilityMethods({ per: 100 }),
  });
}
