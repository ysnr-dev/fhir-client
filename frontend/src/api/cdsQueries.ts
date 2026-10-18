import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchCdsOrderHook,
  fetchCdsPatientView,
  sendCdsFeedback,
  type CdsFeedbackParams,
  type CdsOrderHookParams,
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

/**
 * 処方フォームの order-select。入力が落ち着いた draftOrders(呼び出し側で間を置いたもの)が
 * 変わるたびに呼ぶ。次の応答が届くまで前のカードを出したままにする(入力のたびに一覧が消えないように)。
 */
export function useCdsOrderSelect(params: CdsOrderHookParams | null) {
  return useQuery<CdsPatientViewResult>({
    queryKey: [...CDS_KEY, "order-select", params ? JSON.stringify(params) : null],
    queryFn: () => fetchCdsOrderHook("order-select", params as CdsOrderHookParams),
    enabled: params !== null,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

/** 画面のデータに触れない feedback の送信(処方フォームのカード用)。 */
export function useSendCdsFeedback() {
  return useMutation({
    mutationFn: (params: CdsFeedbackParams) => sendCdsFeedback(params),
    retry: false,
  });
}
