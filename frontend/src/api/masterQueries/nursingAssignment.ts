import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { replaceNursingAssignments, searchNursingAssignments } from "../masterClient";

// ---- 看護の業務分担 ----

const NURSING_ASSIGNMENTS_KEY = ["master", "nursing_assignments"];

/** 病棟 × 日の割り付け(全勤務帯)。 */
export function useWardNursingAssignments(wardId: string | undefined, date: string) {
  return useQuery({
    queryKey: [...NURSING_ASSIGNMENTS_KEY, "ward", wardId ?? "", date],
    queryFn: () => searchNursingAssignments({ assigned_on: date, ward_id: wardId }),
    enabled: Boolean(wardId) && Boolean(date),
  });
}

/** 看護師 × 日の受け持ち(病棟をまたぐ)。 */
export function useMyNursingAssignments(practitionerId: string | null | undefined, date: string) {
  return useQuery({
    queryKey: [...NURSING_ASSIGNMENTS_KEY, "practitioner", practitionerId ?? "", date],
    queryFn: () => searchNursingAssignments({ assigned_on: date, practitioner_id: practitionerId ?? "" }),
    enabled: Boolean(practitionerId) && Boolean(date),
  });
}

export function useReplaceNursingAssignments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: replaceNursingAssignments,
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NURSING_ASSIGNMENTS_KEY }),
  });
}
