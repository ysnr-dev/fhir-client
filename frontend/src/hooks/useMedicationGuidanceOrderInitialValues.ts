import { useMemo } from "react";
import { useMedicationGuidanceOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { parseMedicationGuidanceOrderForm } from "../fhir/medicationGuidanceOrderHelpers";
import { useEditSnapshot } from "./useEditSnapshot";

// 保存済みの服薬指導オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 明細を持たないので、栄養指導と同じくヘッダ 1 件だけを見る。
export function useMedicationGuidanceOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useEditSnapshot(useMedicationGuidanceOrderDetail(srId), srId);

  const serviceRequest = useMemo(
    () => serviceRequestsOf(detail.data?.data).find((request) => request.id === srId),
    [detail.data, srId],
  );
  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);
  const initialValues = useMemo(
    () => (serviceRequest ? parseMedicationGuidanceOrderForm(serviceRequest) : undefined),
    [serviceRequest],
  );

  return {
    serviceRequest,
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された服薬指導オーダーは別の患者のものです。") : undefined),
  };
}
