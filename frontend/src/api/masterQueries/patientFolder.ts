import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addPatientFolderMembers,
  createPatientFolder,
  deletePatientFolder,
  deletePatientFolderMember,
  fetchPatientFolderMembers,
  fetchPatientFolders,
  type PatientFolderMembersPayload,
  type PatientFolderPayload,
  updatePatientFolder,
  updatePatientFolderMember,
} from "../masterClient";

// ---- 患者フォルダ ----

const PATIENT_FOLDERS_KEY = ["master", "patient_folders"];

// 木は持ち主の組(院内共通 + 診療科 X + 本人 Y)ごとにキャッシュする。
export function usePatientFolders(departmentId: string | undefined, practitionerId: string | undefined) {
  return useQuery({
    queryKey: [
      ...PATIENT_FOLDERS_KEY,
      "tree",
      { departmentId: departmentId ?? "", practitionerId: practitionerId ?? "" },
    ],
    queryFn: () => fetchPatientFolders({ department_id: departmentId, practitioner_id: practitionerId }),
  });
}

export function usePatientFolderMembers(folderId: number | undefined, includeDescendants: boolean) {
  return useQuery({
    queryKey: [...PATIENT_FOLDERS_KEY, "members", { folderId, includeDescendants }],
    queryFn: () =>
      fetchPatientFolderMembers({
        patient_folder_id: folderId as number,
        include_descendants: includeDescendants,
      }),
    enabled: folderId !== undefined,
  });
}

/** その患者が入っている、見えるフォルダの登録。 */
export function usePatientFolderMembershipsOf(
  patientId: string,
  departmentId: string | undefined,
  practitionerId: string | undefined,
) {
  return useQuery({
    queryKey: [
      ...PATIENT_FOLDERS_KEY,
      "of-patient",
      { patientId, departmentId: departmentId ?? "", practitionerId: practitionerId ?? "" },
    ],
    queryFn: () =>
      fetchPatientFolderMembers({
        patient_id: patientId,
        department_id: departmentId,
        practitioner_id: practitionerId,
      }),
    enabled: Boolean(patientId),
  });
}

// フォルダの患者数(一覧の member_count)も変わるので、登録を書いたら木ごと読み直す。
export function usePatientFolderMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: PATIENT_FOLDERS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: PatientFolderPayload) => createPatientFolder(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PatientFolderPayload }) =>
        updatePatientFolder(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePatientFolder(id),
      retry: false,
      onSuccess: invalidate,
    }),
    addMembers: useMutation({
      mutationFn: (payload: PatientFolderMembersPayload) => addPatientFolderMembers(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    updateMember: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: { patient_folder_id?: number; note?: string | null } }) =>
        updatePatientFolderMember(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    removeMember: useMutation({
      mutationFn: (id: number) => deletePatientFolderMember(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
