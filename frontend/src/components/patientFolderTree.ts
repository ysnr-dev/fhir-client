import type { PatientFolder, PatientFolderScope } from "../api/masterClient";

// 患者フォルダ(parent_id の隣接リスト)を持ち主ごとの木に組み立てる。backend はフラットな
// 全件を返すだけで、階層の解釈はここに集める(orderSetTree.ts と同じ形)。

export interface PatientFolderNode {
  folder: PatientFolder;
  children: PatientFolderNode[];
}

function byOrder(a: PatientFolder, b: PatientFolder): number {
  const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
  return ao - bo || a.id - b.id;
}

/** 指定した持ち主のフォルダだけを取り出す。院内共通は ownerId を見ない。 */
export function foldersOwnedBy(
  items: PatientFolder[],
  scope: PatientFolderScope,
  ownerId: string | null,
): PatientFolder[] {
  return items.filter((f) => f.scope === scope && (scope === "facility" || f.owner_id === ownerId));
}

export function buildPatientFolderTree(
  items: PatientFolder[],
  scope: PatientFolderScope,
  ownerId: string | null,
): PatientFolderNode[] {
  const owned = foldersOwnedBy(items, scope, ownerId);
  const nodes = new Map<number, PatientFolderNode>();
  for (const folder of owned) nodes.set(folder.id, { folder, children: [] });

  const roots: PatientFolderNode[] = [];
  for (const folder of [...owned].sort(byOrder)) {
    const node = nodes.get(folder.id)!;
    // 親が実在しない行(削除ガードをすり抜けた孤児)は最上位に出して取りこぼさない。
    const parent = folder.parent_id === null ? undefined : nodes.get(folder.parent_id);
    if (parent && parent.folder.id !== folder.id) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** フォルダ選択のプルダウン用に、深さで字下げして平坦化する。excludeId はそのフォルダと子孫を除く。 */
export function flattenPatientFolders(
  tree: PatientFolderNode[],
  excludeId?: number,
): { id: number; label: string; depth: number; folder: PatientFolder }[] {
  const result: { id: number; label: string; depth: number; folder: PatientFolder }[] = [];
  const walk = (nodes: PatientFolderNode[], depth: number) => {
    for (const node of nodes) {
      if (node.folder.id === excludeId) continue;
      result.push({
        id: node.folder.id,
        label: `${"　".repeat(depth)}${node.folder.name}`,
        depth,
        folder: node.folder,
      });
      walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return result;
}

/** 同じ親を持つ兄弟を表示順で返す(↑↓の並び替え対象)。 */
export function patientFolderSiblings(
  items: PatientFolder[],
  folder: PatientFolder,
): PatientFolder[] {
  return foldersOwnedBy(items, folder.scope, folder.owner_id)
    .filter((f) => f.parent_id === folder.parent_id)
    .sort(byOrder);
}

/** 最上位からそのフォルダまでの名前(「研究 / 大腸がん」)。 */
export function patientFolderPath(items: PatientFolder[], folderId: number): string {
  const byId = new Map(items.map((f) => [f.id, f]));
  const names: string[] = [];
  let current = byId.get(folderId);
  for (let depth = 0; current && depth < 50; depth += 1) {
    names.unshift(current.name);
    current = current.parent_id === null ? undefined : byId.get(current.parent_id);
  }
  return names.join(" / ");
}
