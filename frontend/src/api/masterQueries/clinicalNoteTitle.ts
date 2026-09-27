import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ClinicalNoteTitlePayload,
  createClinicalNoteTitle,
  deleteClinicalNoteTitle,
  fetchClinicalNoteTitles,
  updateClinicalNoteTitle,
} from "../masterClient";

// ---- 診療記録のタイトル ----

const CLINICAL_NOTE_TITLES_KEY = ["master", "clinical_note_titles"];

// 診療記録のフォームを開くたびに引くので、少し長めに使い回す(滅多に変わらない)。
export function useClinicalNoteTitles() {
  return useQuery({
    queryKey: [...CLINICAL_NOTE_TITLES_KEY, "list"],
    queryFn: fetchClinicalNoteTitles,
    staleTime: 5 * 60 * 1000,
  });
}

export function useClinicalNoteTitleMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: CLINICAL_NOTE_TITLES_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: ClinicalNoteTitlePayload) => createClinicalNoteTitle(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: ClinicalNoteTitlePayload }) =>
        updateClinicalNoteTitle(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteClinicalNoteTitle(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
