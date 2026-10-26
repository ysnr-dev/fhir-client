// 文書テンプレートのプレースホルダー({{ }} の中身)をカルテの値に解決する。
//
// 書き方は 2 通り。
//   {{患者番号}}            変数一覧(POPULATE_EXPRESSION_OPTIONS)の名前
//   {{%patient.birthDate}}  テンプレートの初期値式と同じ FHIRPath の式(% で始める)
//
// どちらでもない名前は FHIRPath に流さず「一覧に無い」として扱う。日本語の名前は
// FHIRPath としても読めてしまい、書き間違いがエラーにならず空欄になるため。
import fhirpath from "fhirpath";
import fhirpathR4Model from "fhirpath/fhir-context/r4";
import { CHECKED_VALUE, type DocumentFormField, type DocumentFormValues } from "./documentFormLayout";
import { POPULATE_EXPRESSION_OPTIONS } from "./populateContext";

/** ok: 値あり / empty: 該当する記録が無い / unknown: 一覧に無い名前 / error: 式を評価できない */
export type PlaceholderStatus = "ok" | "empty" | "unknown" | "error";

export interface ResolvedPlaceholder {
  token: string;
  value: string;
  status: PlaceholderStatus;
}

// 項目を選んで組み立てる変数(検査項目の最新値)は名前だけでは値が決まらないので、式で書く。
const EXPRESSION_BY_LABEL = new Map(
  POPULATE_EXPRESSION_OPTIONS.filter((option) => !option.parameterized).map((option) => [
    option.label,
    option.expression,
  ]),
);

// Word のオートコレクトは式の中の引用符を全角寄りの記号に変える。
function straightenQuotes(expression: string): string {
  return expression.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

/** プレースホルダーが表す式(変数一覧の名前なら対応する式)。どちらでもなければ undefined。 */
export function placeholderExpression(token: string): string | undefined {
  const byLabel = EXPRESSION_BY_LABEL.get(token);
  if (byLabel) return byLabel;
  return token.startsWith("%") ? straightenQuotes(token) : undefined;
}

/** プレースホルダーが変数一覧の名前か式として書かれているか(値は見ない)。 */
export function isKnownPlaceholder(token: string): boolean {
  return placeholderExpression(token) !== undefined;
}

/**
 * プレースホルダーを buildPopulateContext の環境で評価する。
 * 複数の値を返す式は「、」でつなぐ。
 */
export function resolvePlaceholders(
  tokens: string[],
  context: Record<string, unknown>,
): ResolvedPlaceholder[] {
  return tokens.map((token) => {
    const expression = placeholderExpression(token);
    if (!expression) return { token, value: "", status: "unknown" };
    try {
      const value = joinValues(evaluate(expression, context));
      return { token, value, status: value ? "ok" : "empty" };
    } catch {
      return { token, value: "", status: "error" };
    }
  });
}

// 式は %変数 の参照が主なので、ベースリソースは環境の患者で足りる。
function evaluate(expression: string, context: Record<string, unknown>): unknown[] {
  return fhirpath.evaluate(context.patient as fhir4.Patient, expression, context, fhirpathR4Model) as unknown[];
}

function joinValues(values: unknown[]): string {
  return values
    .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
    .map(String)
    .filter(Boolean)
    .join("、");
}

/**
 * 様式の項目の初期値式を評価して入力値にする。チェックは式が true か値を返せばチェックし(false・空は外す)、
 * 選択は選択肢と一致する値だけ選ぶ。評価できない式の項目は空のままにする。
 */
export function documentFormInitialValues(
  fields: DocumentFormField[],
  context: Record<string, unknown>,
): DocumentFormValues {
  const values: DocumentFormValues = {};
  for (const field of fields) {
    const expression = field.initial_expression ? placeholderExpression(field.initial_expression) : undefined;
    if (!expression) continue;
    let results: unknown[];
    try {
      results = evaluate(expression, context);
    } catch {
      continue;
    }
    if (field.type === "checkbox") {
      if (results.some((v) => v !== false && v !== "" && v !== null && v !== undefined)) values[field.id] = CHECKED_VALUE;
      continue;
    }
    if (field.type === "select") {
      const option = results.map(String).find((v) => field.options?.includes(v));
      if (option) values[field.id] = option;
      continue;
    }
    const value = joinValues(results);
    if (value) values[field.id] = field.type === "date" ? value.slice(0, 10) : value;
  }
  return values;
}

/** 差し込む値の対応表。解決できなかったものは入れない(文書に {{ }} のまま残る)。 */
export function placeholderValues(resolved: ResolvedPlaceholder[]): Map<string, string> {
  return new Map(
    resolved
      .filter((r) => r.status === "ok" || r.status === "empty")
      .map((r) => [r.token, r.value]),
  );
}
