import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFormularyEntry,
  createFormularyGroup,
  deleteFormularyEntry,
  deleteFormularyGroup,
  type FormularyEntryPayload,
  type FormularyGroupPayload,
  fetchFormularyGroups,
  reorderFormularyEntries,
  updateFormularyEntry,
  updateFormularyGroup,
} from "../masterClient";

// 群と薬剤は 1 本の一覧 API で返るので、どちらを変えても同じキーを破棄する。
const FORMULARY_KEY = ["master", "formulary_groups"];

/** 薬効群を薬剤付きで全件。剤形を渡すとその剤形の群だけ。 */
export function useFormularyGroups(dosageForm?: string, enabled = true) {
  return useQuery({
    queryKey: [...FORMULARY_KEY, dosageForm ?? ""],
    queryFn: () => fetchFormularyGroups({ dosage_form: dosageForm || undefined }),
    enabled,
  });
}

/**
 * 医薬品コード → 推奨順位(複数の群に載っていれば最小)。医薬品マスタの行を持たない画面
 * (レジメン編集の薬剤行)で印を出すのに使う。群が読めていない間は null。
 */
export function useFormularyRankLookup() {
  const groups = useFormularyGroups();
  const ranks = useMemo(() => {
    const map = new Map<string, number>();
    for (const group of groups.data ?? []) {
      for (const entry of group.entries) {
        const current = map.get(entry.medicine_code);
        if (current === undefined || entry.rank < current) map.set(entry.medicine_code, entry.rank);
      }
    }
    return map;
  }, [groups.data]);
  return useCallback((code: string) => ranks.get(code) ?? null, [ranks]);
}

export function useFormularyMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: FORMULARY_KEY });

  return {
    createGroup: useMutation({
      mutationFn: (payload: FormularyGroupPayload) => createFormularyGroup(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    updateGroup: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: FormularyGroupPayload }) =>
        updateFormularyGroup(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    removeGroup: useMutation({
      mutationFn: (id: number) => deleteFormularyGroup(id),
      retry: false,
      onSuccess: invalidate,
    }),
    createEntry: useMutation({
      mutationFn: (payload: FormularyEntryPayload) => createFormularyEntry(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    updateEntry: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: FormularyEntryPayload }) =>
        updateFormularyEntry(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    removeEntry: useMutation({
      mutationFn: (id: number) => deleteFormularyEntry(id),
      retry: false,
      onSuccess: invalidate,
    }),
    reorder: useMutation({
      mutationFn: (ids: number[]) => reorderFormularyEntries(ids),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
