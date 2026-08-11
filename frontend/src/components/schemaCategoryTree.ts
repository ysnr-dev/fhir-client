import type { SchemaCategory } from "../api/masterClient";

// シェーマカテゴリ(parent_id の隣接リスト)をツリーに組み立てる。
// backend はフラットな全件を返すだけで、階層の解釈はここに集約する。

export interface CategoryNode {
  category: SchemaCategory;
  children: CategoryNode[];
}

function byOrder(a: SchemaCategory, b: SchemaCategory): number {
  // display_order 昇順(null は末尾)、同値は id で安定化。
  const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
  return ao - bo || a.id - b.id;
}

export function buildCategoryTree(items: SchemaCategory[]): CategoryNode[] {
  const nodes = new Map<number, CategoryNode>();
  for (const category of items) nodes.set(category.id, { category, children: [] });

  const roots: CategoryNode[] = [];
  for (const category of [...items].sort(byOrder)) {
    const node = nodes.get(category.id)!;
    // 親が実在しない行(削除ガードをすり抜けた孤児)はルート扱いで取りこぼさない。
    const parent = category.parent_id === null ? undefined : nodes.get(category.parent_id);
    if (parent && parent.category.id !== category.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// 親カテゴリ選択プルダウン用に、ツリーを深さインデント付きの一覧へ平坦化する。
// excludeId を渡すとそのカテゴリ自身と子孫を除外する(親変更で循環を作らせない)。
export function flattenForSelect(
  tree: CategoryNode[],
  excludeId?: number,
): { id: number; label: string }[] {
  const result: { id: number; label: string }[] = [];
  const walk = (nodes: CategoryNode[], depth: number) => {
    for (const node of nodes) {
      if (node.category.id === excludeId) continue;
      result.push({ id: node.category.id, label: `${"　".repeat(depth)}${node.category.name}` });
      walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return result;
}

// 同じ親を持つ兄弟カテゴリを表示順で返す(↑↓の並び替え対象)。
export function siblingsOf(items: SchemaCategory[], parentId: number | null): SchemaCategory[] {
  return items.filter((c) => c.parent_id === parentId).sort(byOrder);
}
