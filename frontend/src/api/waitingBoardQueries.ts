import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWaitingBoardLinks, issueWaitingBoardLink, revokeWaitingBoardLink } from "./waitingBoardClient";

// 待合表示板の職員向け hook(docs/waiting-board-design.md)。

const BOARD_KEY = ["waiting-board"];

export function useWaitingBoardLinks(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...BOARD_KEY, "links"],
    queryFn: fetchWaitingBoardLinks,
    enabled: options.enabled !== false,
  });
}

/**
 * 「発行」を押したときに 1 本発行する。`nonce` は押すたびに変える印で、同じ印の間は同じリンクを保つ
 * (mutation にすると開発の StrictMode の仮アンマウントで結果を受け取れないため、query にしている)。
 */
export function useIssuedWaitingBoardLink(
  payload: Parameters<typeof issueWaitingBoardLink>[0],
  nonce: string,
) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: [...BOARD_KEY, "issue", nonce],
    queryFn: async () => {
      const link = await issueWaitingBoardLink(payload);
      void queryClient.invalidateQueries({ queryKey: [...BOARD_KEY, "links"] });
      return link;
    },
    enabled: Boolean(nonce),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useRevokeWaitingBoardLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => revokeWaitingBoardLink(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...BOARD_KEY, "links"] }),
  });
}
