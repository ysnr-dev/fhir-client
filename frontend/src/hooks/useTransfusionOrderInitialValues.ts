import { useMemo } from "react";
import { useTransfusionOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import {
  parseTransfusionOrderForm,
  transfusionOrderItemRequests,
} from "../fhir/transfusionOrderHelpers";

// 保存済みの輸血オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 製剤明細も ServiceRequest なので、ヘッダと一緒に取得した明細から組み立てる
// (病理の usePathoOrderInitialValues と同じ形)。
export function useTransfusionOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useTransfusionOrderDetail(srId);

  const { serviceRequest, itemRequests } = useMemo(() => {
    const requests = serviceRequestsOf(detail.data?.data);
    return {
      serviceRequest: requests.find((request) => request.id === srId),
      itemRequests: srId ? transfusionOrderItemRequests(requests, srId) : [],
    };
  }, [detail.data, srId]);

  const initialValues = useMemo(
    () => (serviceRequest ? parseTransfusionOrderForm(serviceRequest, itemRequests) : undefined),
    [itemRequests, serviceRequest],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return {
    serviceRequest,
    /** 更新時に、外された製剤明細を消すために渡す元の明細 id。 */
    itemIds: itemRequests.map((request) => request.id).filter((id): id is string => Boolean(id)),
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された輸血オーダーは別の患者のものです。") : undefined),
  };
}
