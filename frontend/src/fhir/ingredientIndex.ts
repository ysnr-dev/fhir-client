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

/** 薬に含まれる成分 1 つ。 */
export interface IngredientComponent {
  id: number;
  /** その成分が主成分の ATC コード(5 階層目)。 */
  atc: string[];
  /** 1 薬価単位(錠・カプセル)あたりの量。配合剤で分かっているものだけ。 */
  amount: number | null;
  amountUnit: string | null;
}

export interface IngredientIndex {
  /** YJ コード・薬価基準コード・一般名処方コード(上 7 桁以上)から成分を引く。無ければ空。 */
  componentsOf(code: string | null | undefined): IngredientComponent[];
}

export const EMPTY_INGREDIENT_INDEX: IngredientIndex = { componentsOf: () => [] };

export function buildIngredientIndex(
  rows: {
    code_prefix: string;
    ingredient_id: number;
    atc_codes: string[];
    amount: number | null;
    amount_unit: string | null;
  }[],
): IngredientIndex {
  const byPrefix = new Map<string, IngredientComponent[]>();
  for (const row of rows) {
    const component = { id: row.ingredient_id, atc: row.atc_codes, amount: row.amount, amountUnit: row.amount_unit };
    byPrefix.set(row.code_prefix, [...(byPrefix.get(row.code_prefix) ?? []), component]);
  }
  return {
    // 規格で成分や含量が変わる薬(混合型インスリン、配合剤)は上 9 桁で載っているので、先に 9 桁を見る。
    componentsOf(code) {
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
  /** 成分マスタの成分。配合剤は複数、載っていない薬は空。 */
  components: IngredientComponent[];
}

export function drugIdentity(code: string | null | undefined, index: IngredientIndex): DrugIdentity | null {
  const trimmed = (code ?? "").trim();
  if (trimmed.length < KEY_LENGTH) return null;
  return { key: trimmed.slice(0, KEY_LENGTH), components: index.componentsOf(trimmed) };
}

/** 同じ成分を含むか。上 7 桁が同じか、成分の ID が 1 つでも重なれば同じとみなす。 */
export function sameIngredient(a: DrugIdentity, b: DrugIdentity): boolean {
  return a.key === b.key || a.components.some((x) => b.components.some((y) => y.id === x.id));
}

/** 規則のコードの書き方。成分(`I` + 成分の ID)、ATC 分類(`C10AA`)、YJ コードの先頭 4〜7 桁。 */
export type RuleCodeKind = "ingredient" | "atc" | "yj";

export function ruleCodeKind(code: string): RuleCodeKind {
  if (/^I\d+$/.test(code)) return "ingredient";
  return /^[A-Z]/.test(code) ? "atc" : "yj";
}

/** 規則のコードに当たる成分。YJ コードで書いた規則は薬そのものを指すので空。 */
export function ruleComponents(drug: DrugIdentity, code: string): IngredientComponent[] {
  switch (ruleCodeKind(code)) {
    case "ingredient": {
      const id = Number(code.slice(RULE_INGREDIENT_PREFIX.length));
      return drug.components.filter((c) => c.id === id);
    }
    case "atc":
      return drug.components.filter((c) => c.atc.some((atc) => atc.startsWith(code)));
    case "yj":
      return [];
  }
}

/** 規則のコードが薬に当たるか。 */
export function ruleCodeMatches(drug: DrugIdentity, code: string): boolean {
  if (!code) return false;
  return ruleCodeKind(code) === "yj" ? drug.key.startsWith(code) : ruleComponents(drug, code).length > 0;
}

/** 成分の ID を規則のコードにする。 */
export function ruleIngredientCode(ingredientId: number): string {
  return `${RULE_INGREDIENT_PREFIX}${ingredientId}`;
}
