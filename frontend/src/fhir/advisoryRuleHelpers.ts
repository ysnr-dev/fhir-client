// 施設が条件式で定義する警告の規則(docs/advisory-design.md §2.9)。
//
// 規則の条件式は FHIRPath で、テンプレートの初期値式と同じ % 変数(populateContext.ts)を使う。
// 処方・注射ではいま入力している薬剤を %orderItems で参照できる。式の結果に true が含まれるときだけ
// 警告を出し、偽・空・真偽値でない結果・評価の失敗はどれも出さない(式の誤りで診療を止めない)。
import fhirpath from "fhirpath";
import fhirpathR4Model from "fhirpath/fhir-context/r4";
import {
  type Advisory,
  type AdvisoryContext,
  advisoryKey,
  severityOf,
} from "./advisoryHelpers";
import type { CheckedRp } from "./drugCheckHelpers";
import { ingredientKey } from "./medicationSafetyHelpers";
import type { PopulateExpressionOption } from "./populateContext";

export const ADVISORY_RULE_KIND = "facility-rule";

/** 施設の規則に付けられる重さ。止める(block)は付けさせない。 */
export const ADVISORY_RULE_SEVERITIES = ["info", "warning"] as const;
export type AdvisoryRuleSeverity = (typeof ADVISORY_RULE_SEVERITIES)[number];

/** マスタ `master_advisory_rules` の 1 行。 */
export interface AdvisoryRule {
  id: number;
  code: string;
  name: string;
  enabled: boolean;
  display_order: number | null;
  severity: AdvisoryRuleSeverity;
  /** 出す場所。backend の Master::AdvisoryRule::CONTEXTS はこの一覧(ADVISORY_CONTEXTS)の写し。 */
  contexts: AdvisoryContext[];
  expression: string;
  message: string;
  detail: string | null;
  /** 根拠(ガイドライン名か URL)。 */
  basis: string | null;
}

/** %orderItems の 1 要素。入力中の処方・注射の薬剤 1 行。 */
export interface AdvisoryOrderItem {
  /** YJ コード。持たない薬剤は空。 */
  code: string;
  name: string;
  /** 成分のキー(YJ コードの上 7 桁。medicationSafetyHelpers の ingredientKey)。 */
  ingredient: string;
}

/** 規則の式だけが使う変数。テンプレートの変数一覧には出さず、規則の編集画面の変数一覧に足す。 */
export const ADVISORY_RULE_EXTRA_OPTIONS: PopulateExpressionOption[] = [
  {
    group: "オーダー",
    variable: "orderItems",
    label: "入力中の薬剤の YJ コード",
    expression: "%orderItems.code",
    description:
      "処方・注射で入力している薬剤の YJ コード(薬剤ごとに 1 つ)です。「で始まる」で薬効分類(上 4 桁)や成分(上 7 桁)を指定します。処方・注射以外では空です。",
    sample: "3962002F1037",
  },
  {
    group: "オーダー",
    variable: "orderItems",
    label: "入力中の薬剤の名称",
    expression: "%orderItems.name",
    description: "処方・注射で入力している薬剤の名称です。処方・注射以外では空です。",
    sample: "メトグルコ錠250mg",
  },
];

/** 薬剤チェックに渡す形の RP から %orderItems を作る。薬剤を選んでいない行は除く。 */
export function advisoryOrderItemsOf(rps: readonly CheckedRp[]): AdvisoryOrderItem[] {
  return rps.flatMap((rp) =>
    rp.medicines.flatMap((line) =>
      line.medicine
        ? [{ code: line.medicine.yj_code ?? "", name: line.medicine.name, ingredient: ingredientKey(line.medicine) ?? "" }]
        : [],
    ),
  );
}

/** その場面で評価する規則(有効で、出す場所に含まれるもの)。表示順。 */
export function rulesForContext(rules: readonly AdvisoryRule[], context: AdvisoryContext): AdvisoryRule[] {
  return rules
    .filter((rule) => rule.enabled && rule.contexts.includes(context))
    .sort((a, b) => (a.display_order ?? Number.MAX_SAFE_INTEGER) - (b.display_order ?? Number.MAX_SAFE_INTEGER));
}

export type AdvisoryRuleResult = { matched: boolean; error?: undefined } | { matched: false; error: string };

/** 1 件の式を評価する。base は %patient の Patient、env は % 変数。 */
export function evaluateAdvisoryRule(
  expression: string,
  base: fhir4.Patient,
  env: Record<string, unknown>,
): AdvisoryRuleResult {
  try {
    const values = fhirpath.evaluate(base, expression, env, fhirpathR4Model) as unknown[];
    return { matched: values.some((value) => value === true) };
  } catch (e) {
    return { matched: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 警告の出典。根拠が URL ならリンクにし、文なら規則の名前に添える。 */
function ruleSource(rule: AdvisoryRule): Advisory["source"] {
  const basis = rule.basis?.trim();
  if (basis && /^https?:\/\//.test(basis)) return { label: rule.name, url: basis };
  return { label: basis ? `${rule.name}(${basis})` : rule.name };
}

/** 規則を評価し、真になったものを警告にする。式の誤りは出さずに console へ残す。 */
export function evaluateAdvisoryRules(
  rules: readonly AdvisoryRule[],
  base: fhir4.Patient,
  env: Record<string, unknown>,
): Advisory[] {
  return rules.flatMap((rule) => {
    const result = evaluateAdvisoryRule(rule.expression, base, env);
    if (result.error) console.warn(`施設の規則「${rule.name}」の評価に失敗しました:`, result.error);
    if (!result.matched) return [];
    return [
      {
        key: advisoryKey(ADVISORY_RULE_KIND, rule.code),
        kind: ADVISORY_RULE_KIND,
        severity: severityOf(ADVISORY_RULE_KIND, rule.severity === "warning"),
        message: rule.message,
        detail: rule.detail ?? undefined,
        source: ruleSource(rule),
      },
    ];
  });
}
