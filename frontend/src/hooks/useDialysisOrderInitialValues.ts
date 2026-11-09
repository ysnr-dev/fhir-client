import { useMemo } from "react";
import { useDialysisOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { parseDialysisOrderForm } from "../fhir/dialysisOrderHelpers";
import { useEditSnapshot } from "./useEditSnapshot";

// 保存済みの透析オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
export function useDialysisOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useEditSnapshot(useDialysisOrderDetail(srId), srId);

  const serviceRequest = useMemo(
    () => serviceRequestsOf(detail.data?.data).find((request) => request.id === srId),
    [detail.data, srId],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  const initialValues = useMemo(
    () => (serviceRequest ? parseDialysisOrderForm(serviceRequest) : undefined),
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
        ? new Error("指定された透析オーダーは別の患者のものです。")
        : undefined),
  };
}
