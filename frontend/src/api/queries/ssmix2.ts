import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  discardSsmix2Failures,
  fetchSsmix2Failures,
  fetchSsmix2Status,
  fetchSsmix2Warnings,
  retrySsmix2Failures,
} from "../ssmix2Client";

const SSMIX2_KEY = ["ssmix2"] as const;

/** SS-MIX2 出力の状態。開いている間だけ 30 秒ごとに引き直す。 */
export function useSsmix2Status(enabled: boolean) {
  return useQuery({
    queryKey: [...SSMIX2_KEY, "status"],
    queryFn: fetchSsmix2Status,
    enabled,
    refetchInterval: 30 * 1000,
    staleTime: 10 * 1000,
  });
}

export function useSsmix2Failures() {
  return useQuery({ queryKey: [...SSMIX2_KEY, "failures"], queryFn: fetchSsmix2Failures });
}

export function useSsmix2Warnings() {
  return useQuery({ queryKey: [...SSMIX2_KEY, "warnings"], queryFn: fetchSsmix2Warnings });
}

/** 失敗の再実行・破棄。状態の件数と一覧をまとめて引き直す。 */
export function useRetrySsmix2Failures() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retrySsmix2Failures,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SSMIX2_KEY }),
  });
}

export function useDiscardSsmix2Failures() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: discardSsmix2Failures,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SSMIX2_KEY }),
  });
}
