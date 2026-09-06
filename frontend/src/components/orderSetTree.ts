import type { OrderSet, OrderSetScope } from "../api/masterClient";

// オーダーセット(parent_id の隣接リスト)を持ち主ごとのツリーに組み立てる。
// backend はフラットな全件を返すだけで、階層の解釈はここに集約する
// (schemaCategoryTree.ts と同じ形)。

export interface OrderSetNode {
  set: OrderSet;
  children: OrderSetNode[];
}

function byOrder(a: OrderSet, b: OrderSet): number {
  // display_order 昇順(null は末尾)、同値は id で安定化。
  const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
  return ao - bo || a.id - b.id;
}

/** 指定した持ち主のノードだけを取り出す。院内共通は ownerId を見ない。 */
export function ownedBy(items: OrderSet[], scope: OrderSetScope, ownerId: string | null): OrderSet[] {
  return items.filter(
    (s) => s.scope === scope && (scope === "facility" || s.owner_id === ownerId),
  );
}

export function buildOrderSetTree(
  items: OrderSet[],
  scope: OrderSetScope,
  ownerId: string | null,
): OrderSetNode[] {
  const owned = ownedBy(items, scope, ownerId);
  const nodes = new Map<number, OrderSetNode>();
  for (const set of owned) nodes.set(set.id, { set, children: [] });

  const roots: OrderSetNode[] = [];
  for (const set of [...owned].sort(byOrder)) {
    const node = nodes.get(set.id)!;
    // 親が実在しない行(削除ガードをすり抜けた孤児)はルート扱いで取りこぼさない。
    const parent = set.parent_id === null ? undefined : nodes.get(set.parent_id);
    if (parent && parent.set.id !== set.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// 親フォルダ選択プルダウン用に、フォルダだけを深さインデント付きで平坦化する。
// excludeId を渡すとそのフォルダ自身と子孫を除外する(親変更で循環を作らせない)。
export function flattenFoldersForSelect(
  tree: OrderSetNode[],
  excludeId?: number,
): { id: number; label: string }[] {
  const result: { id: number; label: string }[] = [];
  const walk = (nodes: OrderSetNode[], depth: number) => {
    for (const node of nodes) {
      if (node.set.kind !== "folder" || node.set.id === excludeId) continue;
      result.push({ id: node.set.id, label: `${"　".repeat(depth)}${node.set.name}` });
      walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return result;
}

/** 同じ親を持つ兄弟ノードを表示順で返す(↑↓の並び替え対象)。 */
export function siblingsOf(
  items: OrderSet[],
  scope: OrderSetScope,
  ownerId: string | null,
  parentId: number | null,
): OrderSet[] {
  return ownedBy(items, scope, ownerId)
    .filter((s) => s.parent_id === parentId)
    .sort(byOrder);
}
