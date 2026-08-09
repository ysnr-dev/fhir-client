import { useMemo } from "react";
import { useLabOrderDetail } from "../api/queries";
import {
  labOrderItemRequests,
  parseLabOrderForm,
  serviceRequestsOf,
} from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";

// 保存済みの検体検査オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 明細も ServiceRequest なので、ヘッダと一緒に取得した明細から項目を組み立てる。
export function useLabOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useLabOrderDetail(srId);

  const { serviceRequest, itemRequests } = useMemo(() => {
    const requests = serviceRequestsOf(detail.data?.data);
    return {
      serviceRequest: requests.find((request) => request.id === srId),
      itemRequests: srId ? labOrderItemRequests(requests, srId) : [],
    };
  }, [detail.data, srId]);

  const initialValues = useMemo(
    () => (serviceRequest ? parseLabOrderForm(serviceRequest, itemRequests) : undefined),
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
      (patientMismatch ? new Error("指定された検体検査は別の患者のものです。") : undefined),
  };
}
