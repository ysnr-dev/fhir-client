import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPatientCaution,
  deletePatientCaution,
  fetchPatientCautions,
  type PatientCautionPayload,
  updatePatientCaution,
} from "../masterClient";

// ---- 患者の診療上の注意の区分 ----

const PATIENT_CAUTIONS_KEY = ["master", "patient_cautions"];

// 患者帯がカルテを開くたびに引くので、少し長めに使い回す
// (区分マスタは滅多に変わらない)。
export function usePatientCautions() {
  return useQuery({
    queryKey: [...PATIENT_CAUTIONS_KEY, "list"],
    queryFn: fetchPatientCautions,
    staleTime: 5 * 60 * 1000,
  });
}

export function usePatientCautionMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PATIENT_CAUTIONS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: PatientCautionPayload) => createPatientCaution(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PatientCautionPayload }) =>
        updatePatientCaution(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePatientCaution(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
