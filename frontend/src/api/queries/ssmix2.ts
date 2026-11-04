import { useQuery } from "@tanstack/react-query";
import { fetchSsmix2Status } from "../ssmix2Client";

/** SS-MIX2 出力の状態。開いている間だけ 30 秒ごとに引き直す。 */
export function useSsmix2Status(enabled: boolean) {
  return useQuery({
    queryKey: ["ssmix2", "status"],
    queryFn: fetchSsmix2Status,
    enabled,
    refetchInterval: 30 * 1000,
    staleTime: 10 * 1000,
  });
}
