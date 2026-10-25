// テンプレート変数「検査項目の最新値」(%labs)の純粋関数。
//
// %labs は結果項目ごとの最新の検査結果 1 件を並べた配列で、テンプレート側は
//   %labs.where(code = '<結果項目コード>').value
// のように結果項目コード(Observation.code.coding の施設コード)で引いて使う。標準の FHIRPath なので
// 初期値式・計算式・文書テンプレートのプレースホルダーのどれにもそのまま書ける。
//
// 取得は参照されたコードだけ(コードごとに最新 1 件)なので、記入前にテンプレートの式を
// 走査してコードを集める(collectLabCodes)。上流の code 検索は完全一致で、施設コードを持たない
// 旧結果(JLAC11 だけのもの)は拾わない。
import { labResultItemCodeOf, observationLineDisplay } from "./labResultHelpers";

export const LAB_ATTRS = ["value", "unit", "date", "text", "interpretation"] as const;
export type LabAttr = (typeof LAB_ATTRS)[number];
export const LAB_ATTR_LABELS: Record<LabAttr, string> = {
  value: "値",
  unit: "単位",
  date: "採取日",
  text: "値と単位",
  interpretation: "判定",
};

/** %labs の 1 要素。 */
export interface PopulateLabRow {
  code: string;
  name: string;
  /** 数値型(PQ)は数値、それ以外は表示文字列。 */
  value: number | string;
  unit: string;
  /** 検体採取日(YYYY-MM-DD)。 */
  date: string;
  /** H / L / HH / LL。基準値内は空。 */
  interpretation: string;
  /** 「7.2 %」のように値と単位をつないだもの。 */
  text: string;
}

export function labExpression(code: string, attr: LabAttr): string {
  return `%labs.where(code = '${code}').${attr}`;
}

// Word のオートコレクトで引用符が ‘’ に変わっていても拾う(評価時には straightenQuotes が直す)。
const LAB_REFERENCE = /%labs\.where\(\s*code\s*=\s*['‘’]([0-9A-Za-z_-]+)['‘’]\s*\)(?:\.(value|unit|date|text|interpretation))?/g;

/** 式が変数モーダルの出す形そのものなら、コードと属性を返す。 */
export function parseLabExpression(expression: string | undefined): { code: string; attr: LabAttr } | null {
  if (!expression) return null;
  const match = new RegExp(`^${LAB_REFERENCE.source}$`).exec(expression.trim());
  if (!match || !match[2]) return null;
  return { code: match[1], attr: match[2] as LabAttr };
}

/** 式の中で参照している結果項目コード(重複なし、昇順)。 */
export function collectLabCodes(expressions: Iterable<string | undefined>): string[] {
  const codes = new Set<string>();
  for (const expression of expressions) {
    if (!expression) continue;
    for (const match of expression.matchAll(LAB_REFERENCE)) codes.add(match[1]);
  }
  return [...codes].sort();
}

export function populateLabRow(obs: fhir4.Observation): PopulateLabRow {
  const line = observationLineDisplay(obs);
  const quantity = obs.valueQuantity?.value;
  const value = typeof quantity === "number" ? quantity : line.value;
  return {
    code: labResultItemCodeOf(obs),
    name: line.name,
    value,
    unit: line.unit,
    date: obs.effectiveDateTime?.slice(0, 10) ?? "",
    interpretation: line.interpretation,
    text: [line.value, line.unit].filter(Boolean).join(" "),
  };
}
