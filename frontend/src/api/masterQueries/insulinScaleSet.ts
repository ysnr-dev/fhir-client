import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type InsulinScaleSetPayload,
  createInsulinScaleSet,
  deleteInsulinScaleSet,
  fetchInsulinScaleSets,
  updateInsulinScaleSet,
} from "../masterClient";

// ---- インスリンのスライディングスケールのセット ----

const INSULIN_SCALE_SETS_KEY = ["master", "insulin_scale_sets"];

// 注射のスケールを入れるたびに引くので、少し長めに使い回す(滅多に変わらない)。
export function useInsulinScaleSets(enabled = true) {
  return useQuery({
    queryKey: [...INSULIN_SCALE_SETS_KEY, "list"],
    queryFn: fetchInsulinScaleSets,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function useInsulinScaleSetMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: INSULIN_SCALE_SETS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: InsulinScaleSetPayload) => createInsulinScaleSet(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: InsulinScaleSetPayload }) =>
        updateInsulinScaleSet(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteInsulinScaleSet(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
