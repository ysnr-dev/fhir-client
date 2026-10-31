import type { ExamItem } from "./examItem";
import { examMasterClient, type ExamTypeBase } from "./examMaster";

// ---- 内視鏡オーダーのマスタ ----
//
// 構成は examMaster.ts を参照。検査種別は JED(Japan Endoscopy Database)の
// 4区分(上部・小腸・下部・ERCP)との対応(jed_exam_category)を持てる。JED の
// 用語そのものはマスタに持たず、Questionnaire テンプレートの選択肢に転記する。

/** JED の検査種別4区分。JED 対象外の種別(気管支鏡 など)は null。 */
export type JedExamCategory = "upper_gi" | "small_intestine" | "lower_gi" | "ercp";

/** 検査種別(上部消化管内視鏡・下部消化管内視鏡 など)。モダリティに当たる分類軸。 */
export interface EndoscopyExamType extends ExamTypeBase {
  jed_exam_category: JedExamCategory | null;
}

export interface EndoscopyExamTypePayload {
  exam_type_code?: string;
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  jed_exam_category?: JedExamCategory | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

// 内視鏡オーダー項目。列は生理検査と同じなので型は examItem.ts のものを使う。
export type EndoscopyItem = ExamItem;

export const endoscopyMasterClient = examMasterClient<EndoscopyExamType, EndoscopyExamTypePayload>("endoscopy");

/** デモ患者の投入(demo-seed)が項目コードを引くのに使う。 */
export const searchEndoscopyItems = endoscopyMasterClient.searchItems;
