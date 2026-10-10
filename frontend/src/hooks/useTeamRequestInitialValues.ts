import { useMemo } from "react";
import { useTeamRequestDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { parseTeamRequestForm } from "../fhir/teamRequestHelpers";
import { useEditSnapshot } from "./useEditSnapshot";

// 保存済みのチーム依頼をフォームの初期値に復元する。編集と DO の双方から使う(他科依頼と同じ)。
export function useTeamRequestInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useEditSnapshot(useTeamRequestDetail(srId), srId);

  const serviceRequest = useMemo(
    () => serviceRequestsOf(detail.data?.data).find((request) => request.id === srId),
    [detail.data, srId],
  );
  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);
  const initialValues = useMemo(() => (serviceRequest ? parseTeamRequestForm(serviceRequest) : undefined), [serviceRequest]);

  return {
    serviceRequest,
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error: detail.error ?? (patientMismatch ? new Error("指定されたチーム依頼は別の患者のものです。") : undefined),
  };
}
