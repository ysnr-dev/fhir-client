import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createExtractQuery,
  deleteExtractQuery,
  fetchExtractQueries,
  type ExtractQueryPayload,
  updateExtractQuery,
} from "../masterClient";
import type { ExtractTab } from "../../fhir/extractRecordQuery";

const EXTRACT_QUERIES_KEY = ["master", "extract_queries"];

/** タブ(既定は「患者」。"all" ならすべてのタブ)の条件の一覧。 */
export function useExtractQueries(
  departmentId: string | undefined,
  practitionerId: string | undefined,
  enabled = true,
  tab: ExtractTab | "all" = "patient",
  teamIds: string[] = [],
) {
  return useQuery({
    queryKey: [
      ...EXTRACT_QUERIES_KEY,
      "list",
      { departmentId: departmentId ?? "", practitionerId: practitionerId ?? "", tab, teamIds: teamIds.join(",") },
    ],
    queryFn: () =>
      fetchExtractQueries({
        department_id: departmentId,
        practitioner_id: practitionerId,
        tab: tab === "all" ? undefined : tab,
        team_ids: teamIds,
      }),
    enabled,
  });
}

export function useExtractQueryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: EXTRACT_QUERIES_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: ExtractQueryPayload) => createExtractQuery(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: ExtractQueryPayload }) => updateExtractQuery(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteExtractQuery(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
