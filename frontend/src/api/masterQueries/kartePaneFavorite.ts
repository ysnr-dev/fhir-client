import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchKartePaneFavorite, saveKartePaneFavorite } from "../masterClient";

const KARTE_PANE_FAVORITE_KEY = ["master", "karte_pane_favorite"];

/** 自分の右ペインの頻用メニュー。administrator(practitionerId 無し)は読まない。 */
export function useKartePaneFavorite(practitionerId: string | null) {
  return useQuery({
    queryKey: [...KARTE_PANE_FAVORITE_KEY, practitionerId ?? ""],
    queryFn: () => fetchKartePaneFavorite(practitionerId ?? ""),
    enabled: Boolean(practitionerId),
  });
}

export function useSaveKartePaneFavorite(practitionerId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (menuKeys: string[]) => saveKartePaneFavorite(practitionerId ?? "", menuKeys),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KARTE_PANE_FAVORITE_KEY }),
  });
}
