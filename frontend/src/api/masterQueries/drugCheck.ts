import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteDrugDoseRule,
  deleteDrugInteraction,
  type DrugDoseRulePayload,
  type DrugInteractionPayload,
  fetchDrugDoseRules,
  fetchDrugInteractions,
  saveDrugDoseRule,
  saveDrugInteraction,
} from "../masterClient";

// 薬剤チェックの施設マスタ。docs/drug-check-master-design.md

const INTERACTIONS_KEY = ["master", "drug_interactions"];
const DOSE_RULES_KEY = ["master", "drug_dose_rules"];

// オーダー画面は全件を読んで手元で照合する。開くたびに読み直さないよう 5 分は持つ。
const CHECK_STALE_TIME = 5 * 60 * 1000;

export function useDrugInteractions(q = "", enabled = true) {
  return useQuery({
    queryKey: [...INTERACTIONS_KEY, q],
    queryFn: () => fetchDrugInteractions(q || undefined),
    staleTime: CHECK_STALE_TIME,
    enabled,
  });
}

export function useDrugDoseRules(q = "", enabled = true) {
  return useQuery({
    queryKey: [...DOSE_RULES_KEY, q],
    queryFn: () => fetchDrugDoseRules(q || undefined),
    staleTime: CHECK_STALE_TIME,
    enabled,
  });
}

export function useDrugCheckMutations() {
  const queryClient = useQueryClient();
  const invalidateInteractions = () => queryClient.invalidateQueries({ queryKey: INTERACTIONS_KEY });
  const invalidateDoseRules = () => queryClient.invalidateQueries({ queryKey: DOSE_RULES_KEY });

  return {
    saveInteraction: useMutation({
      mutationFn: ({ id, payload }: { id?: number; payload: DrugInteractionPayload }) =>
        saveDrugInteraction(id, payload),
      retry: false,
      onSuccess: invalidateInteractions,
    }),
    removeInteraction: useMutation({
      mutationFn: (id: number) => deleteDrugInteraction(id),
      retry: false,
      onSuccess: invalidateInteractions,
    }),
    saveDoseRule: useMutation({
      mutationFn: ({ id, payload }: { id?: number; payload: DrugDoseRulePayload }) =>
        saveDrugDoseRule(id, payload),
      retry: false,
      onSuccess: invalidateDoseRules,
    }),
    removeDoseRule: useMutation({
      mutationFn: (id: number) => deleteDrugDoseRule(id),
      retry: false,
      onSuccess: invalidateDoseRules,
    }),
  };
}
