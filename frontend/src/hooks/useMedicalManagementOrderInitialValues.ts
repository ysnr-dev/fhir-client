import { useMemo } from "react";
import { useMedicalManagementOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import {
  medicalManagementProceduresOf,
  parseMedicalManagementOrderForm,
} from "../fhir/medicalManagementOrderHelpers";
import { resourcesOfType } from "../fhir/shared";
import { useEditSnapshot } from "./useEditSnapshot";

// 保存済みの指導・管理料オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 実施記録(ハブと加算)も同じ応答から取り、編集の版の固定(楽観ロック)にも使う。
export function useMedicalManagementOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useEditSnapshot(useMedicalManagementOrderDetail(srId), srId);

  const serviceRequest = useMemo(
    () => serviceRequestsOf(detail.data?.data).find((request) => request.id === srId),
    [detail.data, srId],
  );
  const procedures = useMemo(
    () => medicalManagementProceduresOf(resourcesOfType<fhir4.Procedure>(detail.data?.data, "Procedure"), srId ?? ""),
    [detail.data, srId],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  const initialValues = useMemo(
    () => (serviceRequest ? parseMedicalManagementOrderForm(serviceRequest, procedures) : undefined),
    [serviceRequest, procedures],
  );

  return {
    serviceRequest,
    procedures,
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された指導・管理料オーダーは別の患者のものです。") : undefined),
  };
}
