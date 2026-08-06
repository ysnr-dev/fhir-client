import { useMemo } from "react";
import { usePrescriptionDetail } from "../api/queries";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { parseInjectionForm } from "../fhir/injectionHelpers";
import { splitPrescriptionDetailBundle } from "../fhir/prescriptionHelpers";

// 保存済みの注射オーダーを注射フォームの初期値に復元する。編集と DO の双方から使う。
// 構成は usePrescriptionInitialValues と同じ(取得も同じ ServiceRequest 詳細検索を共用)。
export function useInjectionInitialValues(srId: string | undefined, patientId?: string) {
  const detail = usePrescriptionDetail(srId);

  const split = useMemo(
    () =>
      detail.data
        ? splitPrescriptionDetailBundle(detail.data.data)
        : { serviceRequest: undefined, medicationRequests: [] },
    [detail.data],
  );

  const initialValues = useMemo(
    () =>
      split.serviceRequest
        ? parseInjectionForm(split.serviceRequest, split.medicationRequests)
        : undefined,
    [split],
  );

  const patientMismatch = isPatientMismatch(patientId, split.serviceRequest?.subject);

  return {
    ...split,
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ?? (patientMismatch ? new Error("指定された注射は別の患者のものです。") : undefined),
  };
}
