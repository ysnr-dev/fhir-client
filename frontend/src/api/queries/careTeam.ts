import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CARE_TEAM_KIND_SYSTEM } from "../../fhir/careTeamHelpers";
import { createResource, searchResource, updateResource } from "../fhirClient";
import { resourcesOfType } from "./core";

// ---- チーム医療のチーム(docs/care-team-design.md §1) ----

const CARE_TEAM_KEY = ["CareTeam"];

async function fetchCareTeams(params: URLSearchParams): Promise<fhir4.CareTeam[]> {
  params.set("_count", "200");
  params.set("_sort", "name");
  const { data } = await searchResource<fhir4.CareTeam>("CareTeam", params);
  return resourcesOfType<fhir4.CareTeam>(data, "CareTeam");
}

/** チームの一覧。既定は有効なチームだけ(マスタ画面は無効も含めて引く)。 */
export function useCareTeams(options: { includeInactive?: boolean; kind?: string } = {}) {
  return useQuery({
    queryKey: [...CARE_TEAM_KEY, "list", options.includeInactive ? "all" : "active", options.kind ?? ""],
    queryFn: () => {
      const params = new URLSearchParams();
      if (!options.includeInactive) params.set("status", "active");
      if (options.kind) params.set("category", `${CARE_TEAM_KIND_SYSTEM}|${options.kind}`);
      return fetchCareTeams(params);
    },
    // チームの構成は日に何度も変わらない。
    staleTime: 5 * 60 * 1000,
  });
}

/** ログイン中の医療従事者が構成員になっている有効なチーム。 */
export function useMyCareTeams(practitionerId: string | null | undefined) {
  return useQuery({
    queryKey: [...CARE_TEAM_KEY, "mine", practitionerId ?? ""],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("status", "active");
      params.set("participant", `Practitioner/${practitionerId}`);
      return fetchCareTeams(params);
    },
    enabled: Boolean(practitionerId),
    staleTime: 5 * 60 * 1000,
  });
}

/** チームの登録・更新(更新は読んだ版を If-Match に添える)。 */
export function useSaveCareTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (team: fhir4.CareTeam) => {
      if (team.id) {
        const version = team.meta?.versionId;
        const result = await updateResource(team, version ? `W/"${version}"` : "*");
        return result.data;
      }
      const result = await createResource(team);
      return result.data;
    },
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CARE_TEAM_KEY }),
  });
}
