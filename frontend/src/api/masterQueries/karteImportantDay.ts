import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteKarteImportantDay,
  fetchKarteImportantDays,
  saveKarteImportantDay,
  type KarteImportantDay,
  type KarteImportantDaySeverity,
} from "../masterClient";

const KARTE_IMPORTANT_DAYS_KEY = ["master", "karte_important_days"];

/** 患者の重要日を診療日(YYYY-MM-DD)で引ける形にして返す。 */
export function useKarteImportantDays(patientId: string | undefined) {
  return useQuery({
    queryKey: [...KARTE_IMPORTANT_DAYS_KEY, patientId ?? ""],
    queryFn: () => fetchKarteImportantDays(patientId ?? ""),
    enabled: Boolean(patientId),
    select: (rows): ReadonlyMap<string, KarteImportantDay> => new Map(rows.map((row) => [row.day, row])),
  });
}

export function useKarteImportantDayMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    /** severity が null なら解除する。 */
    mutationFn: async ({
      day,
      severity,
      comment,
      setByName,
    }: {
      day: string;
      severity: KarteImportantDaySeverity | null;
      comment: string;
      setByName: string | null;
    }): Promise<void> => {
      if (severity === null) await deleteKarteImportantDay(patientId, day);
      else await saveKarteImportantDay(patientId, day, { severity, comment, setByName });
    },
    retry: false,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [...KARTE_IMPORTANT_DAYS_KEY, patientId] }),
  });
}
