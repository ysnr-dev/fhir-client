import type { ExamItem } from "./examItem";
import { examMasterClient, type ExamTypeBase } from "./examMaster";

// ---- 生理検査オーダーのマスタ ----
//
// 構成は examMaster.ts を参照。検査種別(心電図・超音波検査 など)が放射線のモダリティに当たる分類軸。

export type PhysioExamType = ExamTypeBase;

export interface PhysioExamTypePayload {
  exam_type_code?: string;
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

// 生理検査オーダー項目。列は内視鏡と同じなので型は examItem.ts のものを使う。
export type PhysioItem = ExamItem;

export const physioMasterClient = examMasterClient<PhysioExamType, PhysioExamTypePayload>("physio");

