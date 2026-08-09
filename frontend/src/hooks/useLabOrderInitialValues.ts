import { useMemo } from "react";
import { usePrescriptionDetail } from "../api/queries";
import { parseLabOrderForm } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { splitPrescriptionDetailBundle } from "../fhir/prescriptionHelpers";

// 保存済みの検体検査オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 取得は処方・注射と同じ ServiceRequest 詳細検索を共用する(検体検査は明細リソースを
// 持たないので、返ってくる MedicationRequest は常に空)。
export function useLabOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = usePrescriptionDetail(srId);

  const serviceRequest = useMemo(
    () => (detail.data ? splitPrescriptionDetailBundle(detail.data.data).serviceRequest : undefined),
    [detail.data],
  );

  const initialValues = useMemo(
    () => (serviceRequest ? parseLabOrderForm(serviceRequest) : undefined),
    [serviceRequest],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  return {
    serviceRequest,
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された検体検査は別の患者のものです。") : undefined),
  };
}
