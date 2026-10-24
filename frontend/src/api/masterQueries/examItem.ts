// 検査種別を分類軸に持つオーダー項目(生理検査・内視鏡)の検索条件。項目マスタ画面と
// 項目検索モーダルが同じ条件で部門の hook を呼ぶ。
export interface ExamItemFilters {
  name?: string;
  /** 名称・検査種別をまとめて探す1つの語。 */
  keyword?: string;
  kind?: string;
  /** オーダー単位。"true"=グループ化のみ / "false"=単独オーダーのみ。 */
  groupable?: string;
  examTypeCode?: string;
  active?: boolean;
}
