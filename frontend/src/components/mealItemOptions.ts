// 食事オーダー項目の画面表示で共通に使うラベル。項目マスタの編集画面とオーダー
// 画面が同じ見せ方をするためにここへまとめる。
//
// diet / staple は SS-MIX2 の給食オーダ(OMD^O03)の ODS-1 でいう T(食種、食止めを
// 含む) / D(主食)にあたる。嗜好品(P)・補助食(S)は今回扱わない。

export const MEAL_ITEM_KIND_LABELS: Record<string, string> = {
  diet: "食種",
  staple: "主食",
};
