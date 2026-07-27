import { useMemo } from "react";
import { usePrescriptionDetail } from "../api/queries";
import {
  parsePrescriptionForm,
  splitPrescriptionDetailBundle,
} from "../fhir/prescriptionHelpers";

// 保存済みの処方を処方フォームの初期値に復元する。編集(そのまま復元)と
// 新規作成(DO)の双方から使う。呼び出し側は ready を待ってからフォームを描画すること
// (PrescriptionForm は初期値を useState の初期値としてのみ読むため)。
export function usePrescriptionInitialValues(srId: string | undefined) {
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

  return {
    ...split,
    initialValues,
    // 検査結果と違いマスタの引き直しが無いため、詳細取得の完了(またはエラー)のみを待つ。
    // srId 未指定のときは query が disabled になり isLoading は false のままとなる。
    ready: !detail.isLoading,
    error: detail.error,
  };
}
