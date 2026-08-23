import { usePatientAdmission } from "../api/queries";
import type { PrescriptionSetting } from "../fhir/prescriptionHelpers";

// 新規オーダー・検査結果を出す時点の在院状況。入外区分の初期値(入院中なら「入院」、
// そうでなければ「外来」)と、オーダーに焼き付ける入院病棟を返す。入院の判定はカルテの
// 患者情報(PatientHeader)と同じ問い合わせなので、カルテ画面から開くぶんには取得済みで
// 待たされない。病棟もこの問い合わせの戻り値に入っているので、追加のリクエストは無い。
export interface DefaultOrderSetting {
  setting: PrescriptionSetting;
  /** 入院病棟の Location.id。入院していない・辿れなかったときは空。 */
  wardId: string;
  wardName: string;
  /** 入院かどうかが分かったか。フォームの初期値は初回描画時にしか効かないので、
   *  呼び出し側はこれが true になるまでフォームを描かない。 */
  ready: boolean;
}

export function useDefaultOrderSetting(patientId: string): DefaultOrderSetting {
  const admission = usePatientAdmission(patientId);
  return {
    // 読めなかった場合(エラーなど)は今までどおり外来にしておく。
    setting: admission.data ? "inpatient" : "outpatient",
    wardId: admission.data?.wardId ?? "",
    wardName: admission.data?.wardName ?? "",
    ready: !admission.isPending,
  };
}
