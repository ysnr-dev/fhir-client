import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type MealPatternPayload,
  createMealPattern,
  deleteMealPattern,
  fetchMealPatterns,
  updateMealPattern,
} from "../masterClient";

// ---- パターン食 ----

const MEAL_PATTERNS_KEY = ["master", "meal_patterns"];

// 食事オーダーの登録のたびに引くので、少し長めに使い回す(滅多に変わらない)。
export function useMealPatterns(enabled = true) {
  return useQuery({
    queryKey: [...MEAL_PATTERNS_KEY, "list"],
    queryFn: fetchMealPatterns,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function useMealPatternMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MEAL_PATTERNS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MealPatternPayload) => createMealPattern(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MealPatternPayload }) =>
        updateMealPattern(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMealPattern(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
