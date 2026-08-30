import { useMemo } from "react";
import { useConsultOrderDetail } from "../api/queries";
import { parseConsultOrderForm } from "../fhir/consultOrderHelpers";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";

// 保存済みの他科依頼をフォームの初期値に復元する。編集と DO の双方から使う。
// 明細を持たないので、リハビリ(useRehabOrderInitialValues)と同じくヘッダ 1 件だけを見る。
export function useConsultOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useConsultOrderDetail(srId);

  const serviceRequest = useMemo(
    () => serviceRequestsOf(detail.data?.data).find((request) => request.id === srId),
    [detail.data, srId],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  const initialValues = useMemo(
    () => (serviceRequest ? parseConsultOrderForm(serviceRequest) : undefined),
    [serviceRequest],
  );

  return {
    serviceRequest,
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された他科依頼は別の患者のものです。") : undefined),
  };
}
