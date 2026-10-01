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
import { POPULATE_EXPRESSION_OPTIONS } from "./populateContext";

/** ok: 値あり / empty: 該当する記録が無い / unknown: 一覧に無い名前 / error: 式を評価できない */
export type PlaceholderStatus = "ok" | "empty" | "unknown" | "error";

export interface ResolvedPlaceholder {
  token: string;
  value: string;
  status: PlaceholderStatus;
}

const EXPRESSION_BY_LABEL = new Map(
  POPULATE_EXPRESSION_OPTIONS.map((option) => [option.label, option.expression]),
);

// Word のオートコレクトは式の中の引用符を全角寄りの記号に変える。
function straightenQuotes(expression: string): string {
  return expression.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

function expressionOf(token: string): string | undefined {
  const byLabel = EXPRESSION_BY_LABEL.get(token);
  if (byLabel) return byLabel;
  return token.startsWith("%") ? straightenQuotes(token) : undefined;
}

/** プレースホルダーが変数一覧の名前か式として書かれているか(値は見ない)。 */
export function isKnownPlaceholder(token: string): boolean {
  return expressionOf(token) !== undefined;
}

/**
 * プレースホルダーを buildPopulateContext の環境で評価する。
 * 複数の値を返す式は「、」でつなぐ。
 */
export function resolvePlaceholders(
  tokens: string[],
  context: Record<string, unknown>,
): ResolvedPlaceholder[] {
  // 式は %変数 の参照が主なので、ベースリソースは環境の患者で足りる。
  const resource = context.patient as fhir4.Patient;

  return tokens.map((token) => {
    const expression = expressionOf(token);
    if (!expression) return { token, value: "", status: "unknown" };
    try {
      const values = fhirpath.evaluate(resource, expression, context, fhirpathR4Model) as unknown[];
      const value = values
        .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
        .map(String)
        .filter(Boolean)
        .join("、");
      return { token, value, status: value ? "ok" : "empty" };
    } catch {
      return { token, value: "", status: "error" };
    }
  });
}

/** 差し込む値の対応表。解決できなかったものは入れない(文書に {{ }} のまま残る)。 */
export function placeholderValues(resolved: ResolvedPlaceholder[]): Map<string, string> {
  return new Map(
    resolved
      .filter((r) => r.status === "ok" || r.status === "empty")
      .map((r) => [r.token, r.value]),
  );
}
