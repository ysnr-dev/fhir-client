import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import {
  fetchLabItemCategories,
  fetchMedicineTypeOptions,
  fetchMedicineUsageCategories,
  importMaster,
  searchDiseases,
  searchLabItems,
  searchMedicineUsages,
  searchMedicines,
  searchModifiers,
  type MasterType,
} from "./masterClient";

export interface MedicineUsageFilters {
  basicUsageCategory?: string;
  detailedUsageCategory?: string;
  timingCategory?: string;
  doseCount?: string;
}

const MASTER_SEARCH_PER = 10;

export function useImportMaster() {
  return useMutation({
    mutationFn: ({ masterType, file }: { masterType: MasterType; file: File }) =>
      importMaster(masterType, file),
  });
}

export function useMedicineSearch(
  name: string,
  yakkoCode: string,
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["master", "medicines", name, yakkoCode, page],
    queryFn: () =>
      searchMedicines({
        name: name || undefined,
        yakko_code: yakkoCode || undefined,
        page,
        per: MASTER_SEARCH_PER,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 薬効分類の選択プルダウン用（全件・薬効分類番号順）。変化しないので無期限キャッシュ。
export function useMedicineTypeOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["master", "medicine_types", "options"],
    queryFn: fetchMedicineTypeOptions,
    staleTime: Infinity,
    enabled,
  });
}

export function useMedicineUsageSearch(
  usageName: string,
  filters: MedicineUsageFilters,
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["master", "medicine_usages", usageName, filters, page],
    queryFn: () =>
      searchMedicineUsages({
        usage_name: usageName || undefined,
        basic_usage_category: filters.basicUsageCategory || undefined,
        detailed_usage_category: filters.detailedUsageCategory || undefined,
        timing_category: filters.timingCategory || undefined,
        dose_count: filters.doseCount || undefined,
        page,
        per: MASTER_SEARCH_PER,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMedicineUsageCategories(enabled: boolean) {
  return useQuery({
    queryKey: ["master", "medicine_usages", "categories"],
    queryFn: fetchMedicineUsageCategories,
    staleTime: Infinity,
    enabled,
  });
}

export function useLabItemSearch(name: string, categoryName: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["master", "lab_items", name, categoryName, page],
    queryFn: () =>
      searchLabItems({
        name: name || undefined,
        category_name: categoryName || undefined,
        page,
        per: MASTER_SEARCH_PER,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useLabItemCategories(enabled: boolean) {
  return useQuery({
    queryKey: ["master", "lab_items", "categories"],
    queryFn: fetchLabItemCategories,
    staleTime: Infinity,
    enabled,
  });
}

export function useDiseaseSearch(name: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["master", "diseases", name, page],
    queryFn: () => searchDiseases({ name: name || undefined, page, per: MASTER_SEARCH_PER }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useModifierSearch(name: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["master", "modifiers", name, page],
    queryFn: () => searchModifiers({ name: name || undefined, page, per: MASTER_SEARCH_PER }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 検査結果の編集画面用。保存済みの JLAC11 コードからマスタ情報
// (コード型の選択肢など)を一括で引き直す。
export function useLabItemsByCodes(codes: string[]) {
  return useQuery({
    queryKey: ["master", "lab_items", "by_codes", codes],
    queryFn: () => searchLabItems({ jlac11_code: codes.join(","), per: 100 }),
    staleTime: Infinity,
    enabled: codes.length > 0,
  });
}
