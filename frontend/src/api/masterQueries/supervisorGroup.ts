import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSupervisorGroup,
  createSupervisorGroupMember,
  deleteSupervisorGroup,
  deleteSupervisorGroupMember,
  fetchMySupervision,
  fetchSupervisorGroups,
  type SupervisorGroupMemberPayload,
  type SupervisorGroupPayload,
  updateSupervisorGroup,
  updateSupervisorGroupMember,
} from "../masterClient";

// グループと構成員は 1 本の一覧 API で返るので、どちらを変えても同じキーを破棄する
// (mine も同じキーの下に置き、構成の変更で読み直す)。
const SUPERVISOR_GROUPS_KEY = ["master", "supervisor_groups"];

export function useSupervisorGroups() {
  return useQuery({ queryKey: SUPERVISOR_GROUPS_KEY, queryFn: fetchSupervisorGroups });
}

/**
 * ログイン中の医療従事者から見た指導医・研修医。記録・オーダーを書くたびに引かないよう
 * しばらく持つ(グループの構成は日に何度も変わらない)。
 */
export function useMySupervision(practitionerId: string | null | undefined) {
  return useQuery({
    queryKey: [...SUPERVISOR_GROUPS_KEY, "mine", practitionerId ?? ""],
    queryFn: () => fetchMySupervision(practitionerId ?? undefined),
    enabled: Boolean(practitionerId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSupervisorGroupMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: SUPERVISOR_GROUPS_KEY });

  return {
    createGroup: useMutation({
      mutationFn: (payload: SupervisorGroupPayload) => createSupervisorGroup(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    updateGroup: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: SupervisorGroupPayload }) =>
        updateSupervisorGroup(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    removeGroup: useMutation({
      mutationFn: (id: number) => deleteSupervisorGroup(id),
      retry: false,
      onSuccess: invalidate,
    }),
    createMember: useMutation({
      mutationFn: (payload: SupervisorGroupMemberPayload) => createSupervisorGroupMember(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    updateMember: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: SupervisorGroupMemberPayload }) =>
        updateSupervisorGroupMember(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    removeMember: useMutation({
      mutationFn: (id: number) => deleteSupervisorGroupMember(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
