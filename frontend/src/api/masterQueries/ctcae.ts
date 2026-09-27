import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchCtcaeSocs, searchCtcaeTerms } from "../masterClient";
import { MASTER_SEARCH_PER } from "./medicine";

export function useCtcaeTermSearch(
  filters: { name?: string; soc?: string },
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["master", "ctcae_terms", filters, page],
    queryFn: () => searchCtcaeTerms({ ...filters, page, per: MASTER_SEARCH_PER }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCtcaeSocs(enabled: boolean) {
  return useQuery({
    queryKey: ["master", "ctcae_terms", "socs"],
    queryFn: fetchCtcaeSocs,
    staleTime: Infinity,
    enabled,
  });
}
