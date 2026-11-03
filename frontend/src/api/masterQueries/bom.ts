import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchBomOutcomeAssessments,
  searchBomAssessments,
  searchBomOutcomes,
  type BomSearchParams,
} from "../masterClient";
import { MASTER_SEARCH_PER } from "./medicine";

export function useBomOutcomeSearch(filters: Omit<BomSearchParams, "page" | "per">, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["master", "bom_outcomes", filters, page],
    queryFn: () => searchBomOutcomes({ ...filters, page, per: MASTER_SEARCH_PER }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useBomAssessmentSearch(
  filters: Omit<BomSearchParams, "page" | "per">,
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["master", "bom_assessments", filters, page],
    queryFn: () => searchBomAssessments({ ...filters, page, per: MASTER_SEARCH_PER }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** アウトカムに属する観察項目(BOM の OAT の組)。 */
export function useBomOutcomeAssessments(outcomeCode: string) {
  return useQuery({
    queryKey: ["master", "bom_outcomes", outcomeCode, "assessments"],
    queryFn: () => fetchBomOutcomeAssessments(outcomeCode),
    staleTime: Infinity,
    enabled: Boolean(outcomeCode),
  });
}

/**
 * BOM を取り込んであるか(アウトカム・観察項目それぞれ)。取り込んでいない施設には
 * パス定義の編集で「選択」を出さない(コードは手入力のまま)。
 */
export function useBomAvailability(enabled: boolean) {
  const outcomes = useQuery({
    queryKey: ["master", "bom_outcomes", "count"],
    queryFn: () => searchBomOutcomes({ per: 1 }),
    staleTime: Infinity,
    enabled,
  });
  const assessments = useQuery({
    queryKey: ["master", "bom_assessments", "count"],
    queryFn: () => searchBomAssessments({ per: 1 }),
    staleTime: Infinity,
    enabled,
  });
  return {
    outcomes: (outcomes.data?.total ?? 0) > 0,
    assessments: (assessments.data?.total ?? 0) > 0,
  };
}
