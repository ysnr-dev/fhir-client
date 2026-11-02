import { useMemo } from "react";
import { usePatient, usePopulateSources } from "../api/queries";
import { useAdvisoryRules } from "../api/masterQueries";
import type { Advisory, AdvisoryContext } from "../fhir/advisoryHelpers";
import {
  type AdvisoryOrderItem,
  evaluateAdvisoryRules,
  rulesForContext,
} from "../fhir/advisoryRuleHelpers";
import { buildPopulateContext } from "../fhir/populateContext";

const NO_ORDER_ITEMS: AdvisoryOrderItem[] = [];
const NO_ADVISORIES: Advisory[] = [];

/**
 * 規則の式を患者の文脈で評価する土台。式が参照する % 変数の元データだけを読む(usePopulateSources)。
 * 式が無ければ何も読まない。読み終わるまでは env が null。expressions は呼び出し側で useMemo する。
 */
export function useAdvisoryRuleEnv(
  patientId: string,
  expressions: readonly string[],
  orderItems: readonly AdvisoryOrderItem[] = NO_ORDER_ITEMS,
) {
  const active = Boolean(patientId) && expressions.length > 0;
  const patient = usePatient(active ? patientId : undefined).data?.data;
  const populate = usePopulateSources(active ? patientId : undefined, { expressions });
  const base = useMemo(
    () =>
      active && patient && !populate.isLoading
        ? { patient, context: buildPopulateContext({ patient, ...populate.sources }) }
        : null,
    [active, patient, populate.isLoading, populate.sources],
  );
  // %orderItems は処方・注射以外でも必ず置く(環境に無い変数を参照すると FHIRPath が例外を投げる)。
  const env = useMemo(
    () => (base ? { patient: base.patient, env: { ...base.context, orderItems } } : null),
    [base, orderItems],
  );
  return { env, error: populate.error };
}

/**
 * 施設の規則(docs/advisory-design.md §2.9)のうち、この場面に出すもので真になったものの警告。
 * 患者が決まらない画面(オーダーセットの内容入力)は patientId を空で呼ぶ。
 * 処方・注射は入力中の薬剤を orderItems で渡す(呼び出し側で useMemo する)。
 */
export function useAdvisoryRuleAdvisories(
  patientId: string,
  context: AdvisoryContext,
  orderItems?: readonly AdvisoryOrderItem[],
): Advisory[] {
  const allRules = useAdvisoryRules();
  const rules = useMemo(() => rulesForContext(allRules, context), [allRules, context]);
  const expressions = useMemo(() => rules.map((rule) => rule.expression), [rules]);
  const { env } = useAdvisoryRuleEnv(patientId, expressions, orderItems);
  return useMemo(
    () => (env ? evaluateAdvisoryRules(rules, env.patient, env.env) : NO_ADVISORIES),
    [env, rules],
  );
}
