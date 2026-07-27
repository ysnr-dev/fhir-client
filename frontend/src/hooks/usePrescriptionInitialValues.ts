import { useMemo } from "react";
import { usePrescriptionDetail } from "../api/queries";
import { isPatientMismatch } from "../fhir/patientHelpers";
import {
  parsePrescriptionForm,
  splitPrescriptionDetailBundle,
} from "../fhir/prescriptionHelpers";

// 保存済みの処方を処方フォームの初期値に復元する。編集(そのまま復元)と
// 新規作成(DO)の双方から使う。呼び出し側は ready を待ってからフォームを描画すること
// (PrescriptionForm は初期値を useState の初期値としてのみ読むため)。
//
// patientId は URL 上の患者。処方の subject と食い違う場合は他患者の処方なので
// 初期値を返さず patientMismatch を立てる(呼び出し側でフォームを出さないこと)。
export function usePrescriptionInitialValues(srId: string | undefined, patientId?: string) {
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
        ? parsePrescriptionForm(split.serviceRequest, split.medicationRequests)
        : undefined,
    [split],
  );

  const patientMismatch = isPatientMismatch(patientId, split.serviceRequest?.subject);

  return {
    ...split,
    initialValues: patientMismatch ? undefined : initialValues,
    // 検査結果と違いマスタの引き直しが無いため、詳細取得の完了(またはエラー)のみを待つ。
    // srId 未指定のときは query が disabled になり isLoading は false のままとなる。
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ?? (patientMismatch ? new Error("指定された処方は別の患者のものです。") : undefined),
  };
}
