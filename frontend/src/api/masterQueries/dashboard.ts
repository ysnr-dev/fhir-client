import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createDashboard, deleteDashboard, fetchDashboards, updateDashboard, type DashboardPayload } from "../masterClient";

const DASHBOARDS_KEY = ["master", "dashboards"];

/** 持ち主の組(院内共通 + 診療科 + 自分 + チーム)のダッシュボードの一覧(definition 込み)。 */
export function useDashboards(
  departmentId: string | undefined,
  practitionerId: string | undefined,
  enabled = true,
  teamIds: string[] = [],
) {
  return useQuery({
    queryKey: [
      ...DASHBOARDS_KEY,
      "list",
      { departmentId: departmentId ?? "", practitionerId: practitionerId ?? "", teamIds: teamIds.join(",") },
    ],
    queryFn: () => fetchDashboards({ department_id: departmentId, practitioner_id: practitionerId, team_ids: teamIds }),
    enabled,
  });
}

export function useDashboardMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: DASHBOARDS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: DashboardPayload) => createDashboard(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: DashboardPayload }) => updateDashboard(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteDashboard(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
