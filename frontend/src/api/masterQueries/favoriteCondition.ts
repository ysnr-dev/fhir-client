import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFavoriteCondition,
  deleteFavoriteCondition,
  fetchFavoriteConditions,
  updateFavoriteCondition,
  type FavoriteConditionPayload,
} from "../masterClient";

const FAVORITE_CONDITIONS_KEY = ["master", "favorite_conditions"];

/** 持ち主の組(院内共通 + 診療科 + 自分)の頻用病名の一覧(definition 込み)。 */
export function useFavoriteConditions(departmentId: string | undefined, practitionerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...FAVORITE_CONDITIONS_KEY, "list", { departmentId: departmentId ?? "", practitionerId: practitionerId ?? "" }],
    queryFn: () => fetchFavoriteConditions({ department_id: departmentId, practitioner_id: practitionerId }),
    enabled,
  });
}

export function useFavoriteConditionMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: FAVORITE_CONDITIONS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: FavoriteConditionPayload) => createFavoriteCondition(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: FavoriteConditionPayload }) => updateFavoriteCondition(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteFavoriteCondition(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
