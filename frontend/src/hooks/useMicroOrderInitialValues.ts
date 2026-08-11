import { useMemo } from "react";
import { useMicroOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { microOrderItemRequests, parseMicroOrderForm } from "../fhir/microOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";

// 保存済みの細菌検査オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 明細(検体グループ・検査項目)も ServiceRequest なので、ヘッダと一緒に取得した
// 明細から組み立てる。
export function useMicroOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useMicroOrderDetail(srId);

  const { serviceRequest, itemRequests } = useMemo(() => {
    const requests = serviceRequestsOf(detail.data?.data);
    return {
      serviceRequest: requests.find((request) => request.id === srId),
      itemRequests: srId ? microOrderItemRequests(requests, srId) : [],
    };
  }, [detail.data, srId]);

  const initialValues = useMemo(
    () => (serviceRequest ? parseMicroOrderForm(serviceRequest, itemRequests) : undefined),
    [itemRequests, serviceRequest],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return {
    serviceRequest,
    /** 更新時に、外された明細(検体グループ・検査項目)を消すために渡す元の明細 id。 */
    itemIds: itemRequests.map((request) => request.id).filter((id): id is string => Boolean(id)),
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された細菌検査は別の患者のものです。") : undefined),
  };
}
