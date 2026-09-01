import { useMemo } from "react";
import { useNutritionGuidanceOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { parseNutritionGuidanceOrderForm } from "../fhir/nutritionGuidanceOrderHelpers";

// 保存済みの栄養指導オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 明細を持たないので、リハビリ(useRehabOrderInitialValues)と同じくヘッダ 1 件だけを見る。
export function useNutritionGuidanceOrderInitialValues(
  srId: string | undefined,
  patientId?: string,
) {
  const detail = useNutritionGuidanceOrderDetail(srId);

  const serviceRequest = useMemo(
    () => serviceRequestsOf(detail.data?.data).find((request) => request.id === srId),
    [detail.data, srId],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  const initialValues = useMemo(
    () => (serviceRequest ? parseNutritionGuidanceOrderForm(serviceRequest) : undefined),
    [serviceRequest],
  );

  return {
    serviceRequest,
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch
        ? new Error("指定された栄養指導オーダーは別の患者のものです。")
        : undefined),
  };
}
