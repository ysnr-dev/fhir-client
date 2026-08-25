import { useMemo } from "react";
import { useTreatmentOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import {
  parseTreatmentOrderForm,
  treatmentOrderItemRequests,
} from "../fhir/treatmentOrderHelpers";

// 保存済みの処置オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 明細も ServiceRequest なので、ヘッダと一緒に取得した明細から項目を組み立てる。
export function useTreatmentOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useTreatmentOrderDetail(srId);

  const { serviceRequest, itemRequests } = useMemo(() => {
    const requests = serviceRequestsOf(detail.data?.data);
    return {
      serviceRequest: requests.find((request) => request.id === srId),
      itemRequests: srId ? treatmentOrderItemRequests(requests, srId) : [],
    };
  }, [detail.data, srId]);

  const initialValues = useMemo(
    () => (serviceRequest ? parseTreatmentOrderForm(serviceRequest, itemRequests) : undefined),
    [itemRequests, serviceRequest],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return {
    serviceRequest,
    /** 更新時に、外された明細を消すために渡す元の明細 id。 */
    itemIds: itemRequests.map((request) => request.id).filter((id): id is string => Boolean(id)),
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された処置は別の患者のものです。") : undefined),
  };
}
