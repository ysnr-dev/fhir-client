import type { ExamTypeOption } from "../api/masterClient";

// 検査種別を分類軸に持つオーダー項目(生理検査・内視鏡)の画面表示で共通に使う選択肢・ラベル。
// 項目マスタの編集画面と項目検索モーダル・オーダー画面が同じ見せ方をするためにここへまとめる。
//
// 放射線の radItemOptions と違い、JJ1017 の部品コードを扱う仕掛け
// (モダリティ別の部位絞り込み)は無い。検査種別は専用マスタから素直に並べるだけ。

export const KIND_LABELS: Record<string, string> = {
  single: "単項目",
  set: "セット",
};

/** 検査種別セレクトの選択肢。略称があれば添えて見分けやすくする。 */
export function renderExamTypeOptions(examTypes: ExamTypeOption[]) {
  return examTypes.map((examType) => (
    <option key={examType.exam_type_code} value={examType.exam_type_code}>
      {examType.name}
      {examType.short_name ? `（${examType.short_name}）` : ""}
    </option>
  ));
}
