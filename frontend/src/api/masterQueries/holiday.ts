import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { type Holiday, holidayClient, type HolidayPayload } from "../masterClient";

// ---- 祝日・休診日マスタ ----
//
// カレンダーは表示中の期間だけを引くが、キャッシュは年単位で持つ(週を送るたびに引き直さない)。

const KEY = ["master", "holidays"];

function yearQuery(year: number) {
  return {
    queryKey: [...KEY, "year", year],
    queryFn: () => holidayClient.search(`${year}-01-01`, `${year}-12-31`),
    staleTime: Infinity,
  };
}

function yearsBetween(from: string, to: string): number[] {
  const start = Number(from.slice(0, 4));
  const end = Number(to.slice(0, 4));
  if (!start || !end || start > end || end - start > 20) return [];
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export interface HolidayLookup {
  /** YYYY-MM-DD → 祝日・休診日 */
  holidays: ReadonlyMap<string, Holiday>;
  isLoading: boolean;
  error: Error | null;
}

// combine の参照を固定して、結果が変わったときだけ Map を組み直させる。
function combineYears(results: UseQueryResult<Holiday[]>[]): HolidayLookup {
  const holidays = new Map<string, Holiday>();
  for (const result of results) for (const holiday of result.data ?? []) holidays.set(holiday.holiday_date, holiday);
  return {
    holidays,
    isLoading: results.some((r) => r.isLoading),
    error: results.find((r) => r.error)?.error ?? null,
  };
}

/** from〜to(YYYY-MM-DD)にかかる年の祝日・休診日。 */
export function useHolidays(from: string, to: string): HolidayLookup {
  return useQueries({ queries: yearsBetween(from, to).map(yearQuery), combine: combineYears });
}

/** マスタ画面の 1 年ぶん(日付順)。 */
export function useHolidayYear(year: number) {
  return useQuery(yearQuery(year));
}

export function useHolidayMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: KEY });
  return {
    /** 1 日 1 行なので、期間の休診日は日ごとに登録する。 */
    create: useMutation({
      mutationFn: async (payloads: HolidayPayload[]) => {
        for (const payload of payloads) await holidayClient.create(payload);
      },
      retry: false,
      onSettled: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: Partial<HolidayPayload> }) =>
        holidayClient.update(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => holidayClient.remove(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
