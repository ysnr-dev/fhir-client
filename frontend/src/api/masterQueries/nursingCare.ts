import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type NursingStandardPlanPayload,
  type NursingTaxonomy,
  type NursingTermLevel,
  type NursingTermPayload,
  createNursingStandardPlan,
  createNursingTerm,
  deleteNursingStandardPlan,
  deleteNursingTerm,
  fetchAllNursingTerms,
  fetchNursingStandardPlans,
  fetchNursingTerms,
  updateNursingStandardPlan,
  updateNursingTerm,
} from "../masterClient";

// ---- 看護計画の用語と標準看護計画 ----

const NURSING_TERMS_KEY = ["master", "nursing_terms"];
const NURSING_STANDARD_PLANS_KEY = ["master", "nursing_standard_plans"];

/** taxonomy の領域・類・用語をまとめて引く(画面で木を組む)。滅多に変わらないので長めに使い回す。 */
export function useNursingTermTree(taxonomy: NursingTaxonomy, enabled = true) {
  return useQuery({
    queryKey: [...NURSING_TERMS_KEY, "tree", taxonomy],
    queryFn: async () => ({ items: await fetchAllNursingTerms({ taxonomy }) }),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/** 1 階層ぶん(領域、またはある領域の類、ある類の用語)。階層をたどって選ぶ画面で使う。 */
export function useNursingTermChildren(
  taxonomy: NursingTaxonomy,
  level: NursingTermLevel,
  parentCode: string,
  enabled = true,
) {
  return useQuery({
    queryKey: [...NURSING_TERMS_KEY, "children", taxonomy, level, parentCode],
    queryFn: () => fetchAllNursingTerms({ taxonomy, level, parentCode: parentCode || undefined, active: true }),
    staleTime: 5 * 60 * 1000,
    enabled: enabled && (level === "domain" || Boolean(parentCode)),
  });
}

/** 用語の名称検索(階層をまたいで探す)。 */
export function useNursingTermSearch(taxonomy: NursingTaxonomy, q: string) {
  return useQuery({
    queryKey: [...NURSING_TERMS_KEY, "search", taxonomy, q],
    queryFn: () => fetchNursingTerms({ taxonomy, level: "term", q, active: true }),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    enabled: q.length > 0,
  });
}

/** コードで用語を一括で引く(看護問題のガイダンス・付随項目の表示)。 */
export function useNursingTermsByCode(taxonomy: NursingTaxonomy, codes: string[]) {
  const sorted = [...new Set(codes.filter(Boolean))].sort();
  return useQuery({
    queryKey: [...NURSING_TERMS_KEY, "codes", taxonomy, sorted],
    queryFn: () => fetchNursingTerms({ taxonomy, codes: sorted, level: "term" }),
    staleTime: 5 * 60 * 1000,
    enabled: sorted.length > 0,
  });
}

export function useNursingTermMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: NURSING_TERMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: NursingTermPayload) => createNursingTerm(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: NursingTermPayload }) =>
        updateNursingTerm(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteNursingTerm(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

/** 看護診断に結びつかない標準看護計画。 */
export function useNursingStandardPlansWithoutDiagnosis(enabled = true) {
  return useQuery({
    queryKey: [...NURSING_STANDARD_PLANS_KEY, "without-diagnosis"],
    queryFn: () => fetchNursingStandardPlans({ withoutDiagnosis: true, active: true }),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/** 標準看護計画の名称検索。 */
export function useNursingStandardPlanSearch(q: string) {
  return useQuery({
    queryKey: [...NURSING_STANDARD_PLANS_KEY, "search", q],
    queryFn: () => fetchNursingStandardPlans({ q, active: true }),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    enabled: q.length > 0,
  });
}

/** 標準看護計画。diagnosisCodes を渡すとその看護診断の計画だけ。 */
export function useNursingStandardPlans(diagnosisCodes?: string[], enabled = true) {
  const sorted = diagnosisCodes ? [...new Set(diagnosisCodes.filter(Boolean))].sort() : undefined;
  return useQuery({
    queryKey: [...NURSING_STANDARD_PLANS_KEY, "list", sorted ?? "all"],
    queryFn: () => fetchNursingStandardPlans({ diagnosisCodes: sorted }),
    staleTime: 5 * 60 * 1000,
    enabled: enabled && (sorted === undefined || sorted.length > 0),
  });
}

export function useNursingStandardPlanMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: NURSING_STANDARD_PLANS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: NursingStandardPlanPayload) => createNursingStandardPlan(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: NursingStandardPlanPayload }) =>
        updateNursingStandardPlan(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteNursingStandardPlan(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
