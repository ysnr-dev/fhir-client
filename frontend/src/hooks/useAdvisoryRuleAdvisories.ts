import { useMemo } from "react";
import { useMaintenanceRecords, usePatient, usePopulateSources } from "../api/queries";
import { useAdvisoryRules } from "../api/masterQueries";
import type { Advisory, AdvisoryContext } from "../fhir/advisoryHelpers";
import {
  type AdvisoryOrderItem,
  type AdvisoryRule,
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

/** 規則の評価に要るもの。式の環境と、定期項目を持つ規則の材料(最終実施日・延期の Flag)。 */
export type AdvisoryRuleInput = Pick<AdvisoryRule, "code" | "expression" | "maintenance">;

/**
 * 規則の集まりを評価する材料をまとめて読む。env は式の環境と定期項目の材料の両方が揃うまで null。
 * rules は呼び出し側で useMemo する。
 */
export function useAdvisoryRuleEvaluation(
  patientId: string,
  rules: readonly AdvisoryRuleInput[],
  orderItems?: readonly AdvisoryOrderItem[],
) {
  const expressions = useMemo(() => rules.map((rule) => rule.expression), [rules]);
  const { env, error } = useAdvisoryRuleEnv(patientId, expressions, orderItems);
  const maintenance = useMaintenanceRecords(patientId, rules);
  return {
    env: env && !maintenance.isLoading ? env : null,
    records: maintenance.records,
    error: error ?? maintenance.error,
  };
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
  const { env, records } = useAdvisoryRuleEvaluation(patientId, rules, orderItems);
  return useMemo(
    () => (env ? evaluateAdvisoryRules(rules, env.patient, env.env, records) : NO_ADVISORIES),
    [env, rules, records],
  );
}
