import { useMemo } from "react";
import { useRehabOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { parseRehabOrderForm } from "../fhir/rehabOrderHelpers";

// 保存済みのリハビリオーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 明細を持たないので、食事(useMealOrderInitialValues)と同じくヘッダ 1 件だけを見る。
export function useRehabOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useRehabOrderDetail(srId);

  const serviceRequest = useMemo(
    () => serviceRequestsOf(detail.data?.data).find((request) => request.id === srId),
    [detail.data, srId],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  const initialValues = useMemo(
    () => (serviceRequest ? parseRehabOrderForm(serviceRequest) : undefined),
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
        ? new Error("指定されたリハビリオーダーは別の患者のものです。")
        : undefined),
  };
}
