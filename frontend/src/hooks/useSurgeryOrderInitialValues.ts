import { useMemo } from "react";
import { useSurgeryOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import {
  parseSurgeryOrderForm,
  surgeryOrderItemRequests,
  surgeryOrderResponseIds,
} from "../fhir/surgeryOrderHelpers";

// 保存済みの手術オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 明細(術式)も ServiceRequest なので、ヘッダと一緒に取得した明細から組み立てる。
export function useSurgeryOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useSurgeryOrderDetail(srId);

  const { serviceRequest, itemRequests } = useMemo(() => {
    const requests = serviceRequestsOf(detail.data?.data);
    return {
      serviceRequest: requests.find((request) => request.id === srId),
      itemRequests: srId ? surgeryOrderItemRequests(requests, srId) : [],
    };
  }, [detail.data, srId]);

  const initialValues = useMemo(
    () => (serviceRequest ? parseSurgeryOrderForm(serviceRequest, itemRequests) : undefined),
    [itemRequests, serviceRequest],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return {
    serviceRequest,
    /** 更新時に、外された明細を消すために渡す元の明細 id。 */
    itemIds: itemRequests.map((request) => request.id).filter((id): id is string => Boolean(id)),
    /** 更新時に、紐付けが外れた術前指示の回答を消すために渡す元の回答 id。 */
    responseIds: surgeryOrderResponseIds(serviceRequest ? [serviceRequest] : []),
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された手術は別の患者のものです。") : undefined),
  };
}
