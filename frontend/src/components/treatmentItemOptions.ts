// 処置オーダー項目の画面表示で共通に使う選択肢・ラベル。項目マスタの編集画面と
// 項目検索モーダル・オーダー画面が同じ見せ方をするためにここへまとめる。
//
// 生理検査の physioItemOptions と違い、検査種別の選択肢は無い(処置は分類軸を
// 持たない)。

export const KIND_LABELS: Record<string, string> = {
  single: "単項目",
  set: "セット",
};
