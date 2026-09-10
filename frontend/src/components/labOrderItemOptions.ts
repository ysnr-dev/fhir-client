// 検体検査オーダー項目の選択肢。マスタ画面と検索モーダルで同じものを使う。

export const LAB_KIND_LABELS: Record<string, string> = {
  single: "単項目",
  panel: "パネル",
};

// 検査分野の選択肢。前半は共有項目JLACコードマスタ(JLAC11)の区分名称に合わせ、
// 同マスタが扱わない分野(微生物・遺伝子・病理)を後ろに足している。
export const LAB_CATEGORIES = [
  "尿・糞便等検査",
  "血液学的検査",
  "生化学検査",
  "免疫学的検査",
  "免疫血液学的検査",
  "内分泌学的検査",
  "感染症関連検査",
  "微生物学的検査",
  "遺伝子関連・染色体検査",
  "病理学的検査",
  "その他",
];

// 結果項目のデータ型。配布の共有項目JLACコードマスタのデータタイプと同じ 4 値。
export const LAB_DATA_TYPE_LABELS: Record<string, string> = {
  PQ: "数値",
  CD: "コード",
  CO: "順序コード",
  ST: "文字列",
};

// 基準値の性別区分。空は共通。
export const LAB_REFERENCE_SEX_LABELS: Record<string, string> = {
  "": "共通",
  male: "男性",
  female: "女性",
};
