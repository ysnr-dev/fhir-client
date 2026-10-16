import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchIntakeLinks,
  fetchIntakeResponse,
  fetchIntakeResponses,
  issueIntakeLink,
  markIntakeResponse,
} from "./intakeClient";

// Web 問診の職員向け hook(docs/web-intake-design.md)。

const INTAKE_KEY = ["intake"];

/** 予約ごとの問診の状態(外来一覧の「問診」列)。 */
export function useIntakeLinks(appointmentIds: string[], options: { enabled?: boolean } = {}) {
  const ids = [...new Set(appointmentIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: [...INTAKE_KEY, "links", ids],
    queryFn: () => fetchIntakeLinks(ids),
    enabled: options.enabled !== false && ids.length > 0,
    staleTime: 30_000,
  });
}

/** 患者の取込待ちの回答。患者帯のピクトグラムと取込パネルが読む。 */
export function useIntakeResponses(patientId: string | undefined) {
  return useQuery({
    queryKey: [...INTAKE_KEY, "responses", patientId ?? ""],
    queryFn: () => fetchIntakeResponses(patientId as string),
    enabled: Boolean(patientId),
    staleTime: 30_000,
  });
}

export function useIntakeResponse(id: number | undefined) {
  return useQuery({
    queryKey: [...INTAKE_KEY, "response", id ?? 0],
    queryFn: () => fetchIntakeResponse(id as number),
    enabled: Boolean(id),
  });
}

/**
 * QR モーダルを開いたときに 1 本発行する。`nonce` はモーダルを開くたびに変える印で、開いている間は同じリンクを保つ
 * (mutation にすると開発の StrictMode の仮アンマウントで結果を受け取れないため、query にしている)。
 */
export function useIssuedIntakeLink(payload: Parameters<typeof issueIntakeLink>[0], nonce: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: [...INTAKE_KEY, "issue", nonce],
    queryFn: async () => {
      const link = await issueIntakeLink(payload);
      void queryClient.invalidateQueries({ queryKey: [...INTAKE_KEY, "links"] });
      return link;
    },
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useMarkIntakeResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: number } & Parameters<typeof markIntakeResponse>[1]) =>
      markIntakeResponse(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: INTAKE_KEY }),
  });
}
