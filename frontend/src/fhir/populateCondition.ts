// 様式のチェック項目の初期値に使う条件式(変数一覧の式 + 比較)の組み立てと読み戻し。
//
// 条件式は「<変数の式>.exists(<比較>)」の形の FHIRPath で、値が 1 つでも比較を満たせば true になる
// (傷病名の ICD-10 のように複数の値を返す変数もそのまま使える)。比較する値を「、」かカンマで
// 並べると、そのどれかに当たれば真(「と異なる」だけはどれとも違えば真)。
// 読み戻せない形の式は手で書いたものとして、変数モーダルでは扱わない。

export const CONDITION_OPERATORS = ["exists", "eq", "ne", "ge", "le", "gt", "lt", "startsWith", "contains"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  exists: "値がある",
  eq: "と等しい",
  ne: "と異なる",
  ge: "以上",
  le: "以下",
  gt: "より大きい",
  lt: "より小さい",
  startsWith: "で始まる",
  contains: "を含む",
};

const COMPARISON_SYMBOLS: Partial<Record<ConditionOperator, string>> = {
  eq: "=",
  ne: "!=",
  ge: ">=",
  le: "<=",
  gt: ">",
  lt: "<",
};

export interface PopulateCondition {
  base: string;
  operator: ConditionOperator;
  /** 比較する値(「、」区切りで複数)。exists では空。 */
  operand: string;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

function splitOperand(operand: string): string[] {
  return operand
    .split(/[,、]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function literal(value: string, forceString: boolean): string {
  if (!forceString && NUMBER.test(value)) return value;
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** 条件式を組み立てる。比較する値が無ければ空。 */
export function conditionExpression({ base, operator, operand }: PopulateCondition): string {
  if (!base) return "";
  if (operator === "exists") return `${base}.exists()`;
  const values = splitOperand(operand);
  if (values.length === 0) return "";
  const symbol = COMPARISON_SYMBOLS[operator];
  const parts = values.map((value) =>
    symbol ? `$this ${symbol} ${literal(value, false)}` : `$this.${operator}(${literal(value, true)})`,
  );
  return `${base}.exists(${parts.join(operator === "ne" ? " and " : " or ")})`;
}

function unquote(token: string): string | null {
  if (NUMBER.test(token)) return token;
  const match = /^'((?:[^'\\]|\\.)*)'$/.exec(token);
  return match ? match[1].replace(/\\(.)/g, "$1") : null;
}

/** conditionExpression の形の式なら条件に戻す。それ以外は null。 */
export function parseConditionExpression(expression: string | undefined): PopulateCondition | null {
  const match = /^(.+?)\.exists\((.*)\)$/.exec(expression?.trim() ?? "");
  if (!match) return null;
  const [, base, inner] = match;
  if (!inner) return { base, operator: "exists", operand: "" };

  let operator: ConditionOperator | null = null;
  const values: string[] = [];
  for (const part of inner.split(/ (?:or|and) /)) {
    const comparison = /^\$this (=|!=|>=|<=|>|<) (.+)$/.exec(part);
    const call = /^\$this\.(startsWith|contains)\((.+)\)$/.exec(part);
    const op = comparison
      ? (Object.entries(COMPARISON_SYMBOLS).find(([, symbol]) => symbol === comparison[1])?.[0] as ConditionOperator)
      : (call?.[1] as ConditionOperator | undefined);
    const value = unquote((comparison?.[2] ?? call?.[2] ?? "").trim());
    if (!op || value === null || (operator && operator !== op)) return null;
    operator = op;
    values.push(value);
  }
  if (!operator) return null;
  const condition = { base, operator, operand: values.join("、") };
  // 区切りの解釈違い(値の中の「 or 」など)で組み直すと別の式になるものは読み戻さない。
  return conditionExpression(condition) === expression?.trim() ? condition : null;
}
