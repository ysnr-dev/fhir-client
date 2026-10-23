import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createClinicalDashboard,
  deleteClinicalDashboard,
  fetchClinicalDashboards,
  updateClinicalDashboard,
  type ClinicalDashboardPayload,
} from "../masterClient";

const CLINICAL_DASHBOARDS_KEY = ["master", "clinical_dashboards"];

/** 持ち主の組(院内共通 + 診療科 + 自分)の診療ダッシュボードの一覧(definition 込み)。 */
export function useClinicalDashboards(departmentId: string | undefined, practitionerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...CLINICAL_DASHBOARDS_KEY, "list", { departmentId: departmentId ?? "", practitionerId: practitionerId ?? "" }],
    queryFn: () => fetchClinicalDashboards({ department_id: departmentId, practitioner_id: practitionerId }),
    enabled,
  });
}

export function useClinicalDashboardMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: CLINICAL_DASHBOARDS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: ClinicalDashboardPayload) => createClinicalDashboard(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: ClinicalDashboardPayload }) => updateClinicalDashboard(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteClinicalDashboard(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
