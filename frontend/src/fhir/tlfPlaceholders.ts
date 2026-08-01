// 帳票レイアウト(.tlf)からアイテム ID を種類別に抽出する。
// 抽出規約は backend の Reports::ThinreportsRenderer#layout_item_ids と同一に保つこと:
//   トップレベルの items のみ対象(v1、list 非対応)。id が空のアイテムは無視する。

export interface TlfItemIds {
  /** 回答値・メタ値の出力先になれる text-block の ID */
  textIds: Set<string>;
  /** 描き込み画像の出力先になれる image-block の ID */
  imageIds: Set<string>;
  /** ID を持つ全アイテム(text/ellipse 等を含む。show の対象確認用) */
  allIds: Set<string>;
}

// .tlf のテキストからアイテム ID を集計する。JSON でない・items が無いなど
// レイアウトとして読めない場合は null(呼び出し側はチェックを省略する)。
export function extractTlfItemIds(tlfText: string): TlfItemIds | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(tlfText);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;

  const textIds = new Set<string>();
  const imageIds = new Set<string>();
  const allIds = new Set<string>();
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const { id, type } = item as { id?: unknown; type?: unknown };
    const idText = typeof id === "string" ? id : typeof id === "number" ? String(id) : "";
    if (!idText) continue;

    allIds.add(idText);
    if (type === "text-block") textIds.add(idText);
    else if (type === "image-block") imageIds.add(idText);
  }
  return { textIds, imageIds, allIds };
}
