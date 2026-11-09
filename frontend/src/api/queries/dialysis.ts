import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_DIALYSIS_SHIFTS, sortedDialysisShifts } from "../../fhir/dialysisShiftHelpers";
import { DIALYSIS_ORDER_TYPE, isDialysisServiceRequest } from "../../fhir/dialysisOrderHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { today } from "../../lib/dates";
import { postBundle } from "../fhirClient";
import { fetchOrderAppointmentCancelEntries, invalidateAppointments } from "./appointment";
import { makeOrderDetailHook, ORDER_PERFORM_REVINCLUDES, searchAllPages, setOrderPeriod } from "./core";
import { invalidateOrderDependents, postOrderDeleteBundle } from "./orderDelete";
import { useFacilitySettings } from "./organization";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";

// ---- 透析オーダー ----
//
// リハビリと同じ期間継続型で、明細を持たずヘッダ 1 本で済む(docs/dialysis-order-design.md)。

export const useDialysisOrderDetail = makeOrderDetailHook<fhir4.Resource>("dialysis-order", ORDER_PERFORM_REVINCLUDES);

/** 施設設定のシフト(開始の早い順)。 */
export function useDialysisShifts() {
  const settings = useFacilitySettings();
  return sortedDialysisShifts((settings.data?.dialysis_shifts ?? DEFAULT_DIALYSIS_SHIFTS).shifts);
}

/** その患者の、今日に効いている透析オーダー。患者帯の印に使う。 */
export function useActiveDialysisOrders(patientId: string | undefined) {
  const date = today();
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${DIALYSIS_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, date, date);
  params.set("_sort", "-authoredon");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "dialysis-active", patientId, date],
    queryFn: async () => {
      const { matches } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
        page: 100,
        maxPages: 1,
      });
      return matches.filter(isDialysisServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

export function useUpdateDialysisOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      // 開始日が動くとカードの載る日も変わるので、まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * オーダーを消す。部門が取った予約は道連れで取り消す(予約だけが残って枠を塞ぐのを防ぐ)。
 * 実施記録が付いたオーダーは postOrderDeleteBundle が止める。
 *
 * useDeleteDialysisOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteDialysisOrderRequest = async (srId: string) => {
  const appointmentEntries = await fetchOrderAppointmentCancelEntries(srId);
  return postOrderDeleteBundle({
    resourceType: "Bundle",
    type: "transaction",
    entry: [...appointmentEntries, { request: { method: "DELETE", url: `ServiceRequest/${srId}` } }],
  });
};

export function useDeleteDialysisOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteDialysisOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      invalidateAppointments(queryClient);
      invalidateOrderDependents(queryClient);
    },
  });
}
