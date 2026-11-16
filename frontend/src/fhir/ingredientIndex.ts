// 成分マスタ(コードの上 7 桁・上 9 桁 → 成分)での突き合わせ。docs/drug-check-master-design.md
//
// YJ コードの上 7 桁は薬効分類を含むので、同じ成分でも効能が違えば別のキーになる
// (アスピリンの解熱鎮痛 1143001 と抗血小板 3399007)。成分マスタに載っている薬は薬効分類を含まない
// 成分の ID で比べ、載っていない薬(外用薬・新しい成分)は上 7 桁で比べる。

/** 成分マスタを引くコードの長さ(薬効分類 4 桁 + 成分 3 桁 + 剤形 1 桁 + 規格 1 桁)。 */
const LOOKUP_LENGTH = 9;
const KEY_LENGTH = 7;

/** 薬剤チェックの規則に成分を書くときの接頭辞(`I` + 成分の ID)。 */
const RULE_INGREDIENT_PREFIX = "I";

export interface IngredientIndex {
  /** YJ コード・薬価基準コード・一般名処方コード(上 7 桁以上)から成分の ID を引く。無ければ空。 */
  idsOf(code: string | null | undefined): number[];
}

export const EMPTY_INGREDIENT_INDEX: IngredientIndex = { idsOf: () => [] };

export function buildIngredientIndex(
  rows: { code_prefix: string; ingredient_id: number }[],
): IngredientIndex {
  const byPrefix = new Map<string, number[]>();
  for (const row of rows) {
    byPrefix.set(row.code_prefix, [...(byPrefix.get(row.code_prefix) ?? []), row.ingredient_id]);
  }
  return {
    // 規格で成分が変わる薬(混合型インスリンなど)だけ上 9 桁で載っているので、先に 9 桁を見る。
    idsOf(code) {
      const trimmed = (code ?? "").trim();
      return (
        byPrefix.get(trimmed.slice(0, LOOKUP_LENGTH)) ?? byPrefix.get(trimmed.slice(0, KEY_LENGTH)) ?? []
      );
    },
  };
}

/** 成分マスタを引くためにコードを切り詰める(保存する側が持つ長さ)。 */
export function ingredientLookupCode(code: string | null | undefined): string {
  return (code ?? "").trim().slice(0, LOOKUP_LENGTH);
}

/** 突き合わせに使う薬 1 つぶんの成分。 */
export interface DrugIdentity {
  /** コードの上 7 桁。 */
  key: string;
  /** 成分マスタの成分の ID。配合剤は複数、載っていない薬は空。 */
  ids: number[];
}

export function drugIdentity(code: string | null | undefined, index: IngredientIndex): DrugIdentity | null {
  const trimmed = (code ?? "").trim();
  if (trimmed.length < KEY_LENGTH) return null;
  return { key: trimmed.slice(0, KEY_LENGTH), ids: index.idsOf(trimmed) };
}

/** 同じ成分を含むか。上 7 桁が同じか、成分の ID が 1 つでも重なれば同じとみなす。 */
export function sameIngredient(a: DrugIdentity, b: DrugIdentity): boolean {
  return a.key === b.key || a.ids.some((id) => b.ids.includes(id));
}

/** 規則のコード(YJ 先頭 4〜7 桁、または `I` + 成分の ID)が薬に当たるか。 */
export function ruleCodeMatches(drug: DrugIdentity, code: string): boolean {
  if (!code) return false;
  if (code.startsWith(RULE_INGREDIENT_PREFIX)) {
    return drug.ids.includes(Number(code.slice(RULE_INGREDIENT_PREFIX.length)));
  }
  return drug.key.startsWith(code);
}

/** 成分の ID を規則のコードにする。 */
export function ruleIngredientCode(ingredientId: number): string {
  return `${RULE_INGREDIENT_PREFIX}${ingredientId}`;
}
