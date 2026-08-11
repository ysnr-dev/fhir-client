import { useMemo } from "react";
import { useRadOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import {
  parseRadOrderForm,
  radOrderItemRequests,
  radOrderResponseIds,
} from "../fhir/radOrderHelpers";

// 保存済みの放射線検査オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 明細も ServiceRequest なので、ヘッダと一緒に取得した明細から項目を組み立てる。
export function useRadOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useRadOrderDetail(srId);

  const { serviceRequest, itemRequests } = useMemo(() => {
    const requests = serviceRequestsOf(detail.data?.data);
    return {
      serviceRequest: requests.find((request) => request.id === srId),
      itemRequests: srId ? radOrderItemRequests(requests, srId) : [],
    };
  }, [detail.data, srId]);

  const initialValues = useMemo(
    () => (serviceRequest ? parseRadOrderForm(serviceRequest, itemRequests) : undefined),
    [itemRequests, serviceRequest],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return {
    serviceRequest,
    /** 更新時に、外された明細を消すために渡す元の明細 id。 */
    itemIds: itemRequests.map((request) => request.id).filter((id): id is string => Boolean(id)),
    /** 同じく、参照が外れたテンプレート回答を消すために渡す元の回答 id。 */
    responseIds: radOrderResponseIds(itemRequests),
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された放射線検査は別の患者のものです。") : undefined),
  };
}
