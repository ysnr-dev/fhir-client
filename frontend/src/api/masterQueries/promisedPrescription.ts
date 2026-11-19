import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPromisedPrescription,
  deletePromisedPrescription,
  fetchPromisedPrescription,
  searchPromisedPrescriptions,
  updatePromisedPrescription,
  type PromisedPrescriptionPayload,
} from "../masterClient";

const PROMISED_KEY = ["master", "promised_prescriptions"];

export function usePromisedPrescriptionSearch(
  filters: { name?: string; active?: boolean },
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...PROMISED_KEY, "search", filters.name ?? "", filters.active ?? false, page],
    queryFn: () => searchPromisedPrescriptions({ ...filters, page }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePromisedPrescription(id: number | null) {
  return useQuery({
    queryKey: [...PROMISED_KEY, "detail", id],
    queryFn: () => fetchPromisedPrescription(id as number),
    enabled: id !== null,
  });
}

export function usePromisedPrescriptionMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PROMISED_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: PromisedPrescriptionPayload) => createPromisedPrescription(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PromisedPrescriptionPayload }) =>
        updatePromisedPrescription(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePromisedPrescription(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
