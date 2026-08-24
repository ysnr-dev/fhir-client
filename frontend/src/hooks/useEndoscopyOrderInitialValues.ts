import { useMemo } from "react";
import { useEndoscopyOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import {
  parseEndoscopyOrderForm,
  endoscopyOrderItemRequests,
  endoscopyOrderResponseIds,
} from "../fhir/endoscopyOrderHelpers";

// 保存済みの内視鏡オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 明細も ServiceRequest なので、ヘッダと一緒に取得した明細から項目を組み立てる。
export function useEndoscopyOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useEndoscopyOrderDetail(srId);

  const { serviceRequest, itemRequests } = useMemo(() => {
    const requests = serviceRequestsOf(detail.data?.data);
    return {
      serviceRequest: requests.find((request) => request.id === srId),
      itemRequests: srId ? endoscopyOrderItemRequests(requests, srId) : [],
    };
  }, [detail.data, srId]);

  const initialValues = useMemo(
    () => (serviceRequest ? parseEndoscopyOrderForm(serviceRequest, itemRequests) : undefined),
    [itemRequests, serviceRequest],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return {
    serviceRequest,
    /** 更新時に、外された明細を消すために渡す元の明細 id。 */
    itemIds: itemRequests.map((request) => request.id).filter((id): id is string => Boolean(id)),
    /** 同じく、参照が外れたテンプレート回答を消すために渡す元の回答 id。 */
    responseIds: endoscopyOrderResponseIds(itemRequests),
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された内視鏡は別の患者のものです。") : undefined),
  };
}
