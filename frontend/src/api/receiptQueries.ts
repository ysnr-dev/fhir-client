import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelBilling,
  fetchBillingPreview,
  fetchBillingStatus,
  fetchReceiptStatus,
  refreshReceiptPatient,
  sendBilling,
} from "./receiptClient";

const STATUS_KEY = ["receipt", "status"];

function billingKey(patientId: string, date: string, suffix: string) {
  return ["receipt", "billing", suffix, patientId, date];
}

/**
 * 連携が使えるかどうか。連携UIの出し分けはすべてこれを見る。
 * 無効な環境で毎回叩いても意味が無いので、セッション中は取り直さない。
 */
export function useReceiptStatus() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: fetchReceiptStatus,
    staleTime: Infinity,
    retry: false,
  });
}

/** 患者・保険をレセコンから取り直す。取り込み先は上流の Patient と Coverage。 */
export function useRefreshReceiptPatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patientId: string) => refreshReceiptPatient(patientId),
    retry: false,
    onSuccess: (_data, patientId) => {
      queryClient.invalidateQueries({ queryKey: ["coverages", patientId] });
      queryClient.invalidateQueries({ queryKey: ["patient", patientId] });
    },
  });
}

export function useBillingPreview(
  patientId: string,
  date: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: billingKey(patientId, date, "preview"),
    queryFn: () => fetchBillingPreview({ patient_id: patientId, date }),
    enabled: options.enabled !== false && !!patientId && !!date,
    retry: false,
  });
}

/** 送信済みかはレセコンに訊く。カルテ側に控えを持たない。 */
export function useBillingStatus(
  patientId: string,
  date: string,
  departmentCode?: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [...billingKey(patientId, date, "status"), departmentCode ?? ""],
    queryFn: () =>
      fetchBillingStatus({ patient_id: patientId, date, department_code: departmentCode }),
    enabled: options.enabled !== false && !!patientId && !!date,
    retry: false,
  });
}

export function useSendBilling() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sendBilling,
    retry: false,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: billingKey(variables.patient_id, variables.date, "status"),
      });
    },
  });
}

export function useCancelBilling() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelBilling,
    retry: false,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: billingKey(variables.patient_id, variables.date, "status"),
      });
    },
  });
}
