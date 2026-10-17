import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HomeLayoutBody } from "../../fhir/homeCards";
import { fetchHomeLayout, resetHomeLayout, saveHomeLayout } from "../masterClient";

const HOME_LAYOUT_KEY = ["master", "home_layout"];

/** 自分のホームのカードの並び。administrator(practitionerId 無し)は読まない。 */
export function useHomeLayout(practitionerId: string | null) {
  return useQuery({
    queryKey: [...HOME_LAYOUT_KEY, practitionerId ?? ""],
    queryFn: () => fetchHomeLayout(practitionerId ?? ""),
    enabled: Boolean(practitionerId),
  });
}

export function useHomeLayoutMutations(practitionerId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: HOME_LAYOUT_KEY });

  return {
    save: useMutation({
      mutationFn: (definition: HomeLayoutBody) => saveHomeLayout(practitionerId ?? "", definition),
      retry: false,
      onSuccess: invalidate,
    }),
    reset: useMutation({
      mutationFn: () => resetHomeLayout(practitionerId ?? ""),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
