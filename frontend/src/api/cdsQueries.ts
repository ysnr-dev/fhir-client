import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchCdsPatientView,
  sendCdsFeedback,
  type CdsFeedbackParams,
  type CdsPatientViewResult,
} from "./cdsClient";

const CDS_KEY = ["cds"];

function patientViewKey(patientId: string | undefined, encounterId: string | undefined) {
  return [...CDS_KEY, "patient-view", patientId, encounterId ?? ""];
}

/**
 * カルテを開いたときの patient-view。外部のサービスを呼ぶ POST だが、開いた時点で 1 回だけ
 * 行う読み取りなので useQuery にする(StrictMode の二重 effect で 2 回呼ばない)。
 * 失敗してもカルテは普通に開けるので、retry はしない。
 */
export function useCdsPatientView(patientId: string | undefined, encounterId?: string) {
  return useQuery<CdsPatientViewResult>({
    queryKey: patientViewKey(patientId, encounterId),
    queryFn: () => fetchCdsPatientView(patientId as string, encounterId),
    enabled: Boolean(patientId),
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** 無視(override)の送信。送ったカードは吹き出しから外す(次に開いたときに出すかはサービスが決める)。 */
export function useCdsFeedback(patientId: string | undefined, encounterId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CdsFeedbackParams) => sendCdsFeedback(params),
    retry: false,
    onSuccess: (_result, params) => {
      queryClient.setQueryData<CdsPatientViewResult>(patientViewKey(patientId, encounterId), (current) =>
        current ? { ...current, cards: current.cards.filter((card) => card.uuid !== params.card) } : current,
      );
    },
  });
}
