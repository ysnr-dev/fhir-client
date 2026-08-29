// 輸血製剤の画面表示で共通に使うラベル。製剤マスタの編集画面とオーダー画面が
// 同じ見せ方をするためにここへまとめる(食事の mealItemOptions と同じ役割)。
//
// 製剤区分は部門一覧の絞り込み軸で、日本赤十字社の製品分類に合わせた 5 つ。
// 「その他」はアルブミン製剤など、輸血部門を通すが上の 4 区分に入らないもの。

export const TRANSFUSION_CATEGORY_OPTIONS: { code: string; display: string }[] = [
  { code: "rbc", display: "赤血球" },
  { code: "ffp", display: "血漿" },
  { code: "plt", display: "血小板" },
  { code: "auto", display: "自己血" },
  { code: "other", display: "その他" },
];

export const TRANSFUSION_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  TRANSFUSION_CATEGORY_OPTIONS.map((o) => [o.code, o.display]),
);

export function transfusionCategoryLabel(code: string | null | undefined): string {
  return (code && TRANSFUSION_CATEGORY_LABELS[code]) || code || "";
}
