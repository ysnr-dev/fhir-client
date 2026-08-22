import { usePatientAdmission } from "../api/queries";
import type { PrescriptionSetting } from "../fhir/prescriptionHelpers";

// 新規オーダー・検査結果の入外区分の初期値。入院中の患者なら「入院」、そうでなければ
// 「外来」。入院の判定はカルテの患者情報(PatientHeader)と同じ問い合わせなので、
// カルテ画面から開くぶんには取得済みで待たされない。
export interface DefaultOrderSetting {
  setting: PrescriptionSetting;
  /** 入院かどうかが分かったか。フォームの初期値は初回描画時にしか効かないので、
   *  呼び出し側はこれが true になるまでフォームを描かない。 */
  ready: boolean;
}

export function useDefaultOrderSetting(patientId: string): DefaultOrderSetting {
  const admission = usePatientAdmission(patientId);
  return {
    // 読めなかった場合(エラーなど)は今までどおり外来にしておく。
    setting: admission.data ? "inpatient" : "outpatient",
    ready: !admission.isPending,
  };
}
