import { useMemo } from "react";
import { usePathoOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import {
  pathoOrderItemRequests,
  pathoOrderResponseIds,
  parsePathoOrderForm,
} from "../fhir/pathoOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";

// 保存済みの病理検査オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 検体明細も ServiceRequest なので、ヘッダと一緒に取得した明細から組み立てる。
export function usePathoOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = usePathoOrderDetail(srId);

  const { serviceRequest, itemRequests } = useMemo(() => {
    const requests = serviceRequestsOf(detail.data?.data);
    return {
      serviceRequest: requests.find((request) => request.id === srId),
      itemRequests: srId ? pathoOrderItemRequests(requests, srId) : [],
    };
  }, [detail.data, srId]);

  const initialValues = useMemo(
    () => (serviceRequest ? parsePathoOrderForm(serviceRequest, itemRequests) : undefined),
    [itemRequests, serviceRequest],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return {
    serviceRequest,
    /** 更新時に、外された検体明細を消すために渡す元の明細 id。 */
    itemIds: itemRequests.map((request) => request.id).filter((id): id is string => Boolean(id)),
    /** 更新時に、テンプレートを外したら消すための元の記入内容 id。 */
    responseIds: serviceRequest ? pathoOrderResponseIds([serviceRequest]) : [],
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された病理検査は別の患者のものです。") : undefined),
  };
}
