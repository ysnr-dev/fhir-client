import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { importMaster, searchMedicineUsages, searchMedicines, type MasterType } from "./masterClient";

const MASTER_SEARCH_PER = 10;

export function useImportMaster() {
  return useMutation({
    mutationFn: ({ masterType, file }: { masterType: MasterType; file: File }) =>
      importMaster(masterType, file),
  });
}

export function useMedicineSearch(name: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["master", "medicines", name, page],
    queryFn: () => searchMedicines({ name: name || undefined, page, per: MASTER_SEARCH_PER }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMedicineUsageSearch(usageName: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["master", "medicine_usages", usageName, page],
    queryFn: () =>
      searchMedicineUsages({ usage_name: usageName || undefined, page, per: MASTER_SEARCH_PER }),
    placeholderData: keepPreviousData,
    enabled,
  });
}
