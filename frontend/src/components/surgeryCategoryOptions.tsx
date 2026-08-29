import type { SurgeryCategory } from "../api/masterClient";

// 術式の種別(分類)を画面に出すための共通処理。分類は親子になっている
// (点数表 第10部の「款 → 区分」)ので、平らな一覧を木の順に並べ直してから使う。
// 生理検査の physioItemOptions に当たるが、あちらは 1 段なので並べ替えが要らない。

/** 木の順に並べた1行。depth は最上位が 0。 */
export interface SurgeryCategoryNode {
  category: SurgeryCategory;
  depth: number;
}

/**
 * 平らな分類一覧を、最上位から深さ優先で並べ直す。サーバーは同じ親の中での
 * 並び順(display_order → コード)で返すので、その順序をそのまま保つ。
 *
 * 親が一覧に無い分類(有効期間で親だけ外れた・親を消した直後 など)は、木から
 * 落ちて画面から触れなくなると困るので、最上位の後ろに続けて出す。
 */
export function buildSurgeryCategoryTree(categories: SurgeryCategory[]): SurgeryCategoryNode[] {
  const byParent = new Map<string, SurgeryCategory[]>();
  const codes = new Set(categories.map((c) => c.category_code));
  const rootKey = "";

  for (const category of categories) {
    // 親が居ない分類も最上位として扱う(でないと画面から見えなくなる)。
    const parent = category.parent_code && codes.has(category.parent_code) ? category.parent_code : rootKey;
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(category);
    else byParent.set(parent, [category]);
  }

  const nodes: SurgeryCategoryNode[] = [];
  const walk = (parent: string, depth: number) => {
    for (const category of byParent.get(parent) ?? []) {
      nodes.push({ category, depth });
      // 循環していても止まるよう、既に出した分類は展開しない。
      if (category.category_code !== parent) walk(category.category_code, depth + 1);
    }
  };
  walk(rootKey, 0);
  return nodes;
}

/** 分類セレクトの選択肢。段の深さは全角空白で字下げして表す。 */
export function renderSurgeryCategoryOptions(categories: SurgeryCategory[]) {
  return buildSurgeryCategoryTree(categories).map(({ category, depth }) => (
    <option key={category.category_code} value={category.category_code}>
      {"　".repeat(depth)}
      {category.name}
    </option>
  ));
}

/** 分類コード → 名称。マスタから消えた分類はコードをそのまま返す。 */
export function surgeryCategoryName(categories: SurgeryCategory[], code: string | null): string {
  if (!code) return "";
  return categories.find((c) => c.category_code === code)?.name ?? code;
}

/** 最上位からその分類までの名称("腹部 > 胃、食道、腸、他")。 */
export function surgeryCategoryPathName(
  categories: SurgeryCategory[],
  code: string | null,
): string {
  if (!code) return "";

  const names: string[] = [];
  const seen = new Set<string>();
  let current = categories.find((c) => c.category_code === code);
  if (!current) return code;

  while (current && !seen.has(current.category_code)) {
    seen.add(current.category_code);
    names.unshift(current.name);
    const parent: string | null = current.parent_code;
    current = parent ? categories.find((c) => c.category_code === parent) : undefined;
  }
  return names.join(" > ");
}

/**
 * その分類と配下すべてのコード。親分類のセレクトから自分の枝を外すために使う
 * (輪になる指定はサーバーでも弾くが、選べてしまうと分かりにくいので出さない)。
 */
export function surgeryCategorySubtreeCodes(
  categories: SurgeryCategory[],
  code: string,
): Set<string> {
  const codes = new Set([code]);
  // 親は必ず子より前に並ぶとは限らないので、増えなくなるまで繰り返す。
  let added = true;
  while (added) {
    added = false;
    for (const category of categories) {
      if (codes.has(category.category_code)) continue;
      if (category.parent_code && codes.has(category.parent_code)) {
        codes.add(category.category_code);
        added = true;
      }
    }
  }
  return codes;
}
