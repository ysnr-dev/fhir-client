import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createWardMap, deleteWardMap, searchWardMaps, updateWardMap, type WardMapPayload } from "../masterClient";

// ---- 病棟マップ ----

const WARD_MAPS_KEY = ["master", "ward_maps"];

/** 病棟のマップ(1 病棟 1 行)。無ければ null。 */
export function useWardMap(wardId: string | undefined) {
  return useQuery({
    queryKey: [...WARD_MAPS_KEY, "by-ward", wardId ?? ""],
    queryFn: async () => (await searchWardMaps({ ward_location_id: wardId, per: 1 })).items[0] ?? null,
    enabled: Boolean(wardId),
  });
}

export function useWardMapMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: WARD_MAPS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: WardMapPayload) => createWardMap(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: WardMapPayload }) => updateWardMap(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteWardMap(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
