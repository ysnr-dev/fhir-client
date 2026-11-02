import type { AdvisoryRule } from "../../fhir/advisoryRuleHelpers";
import { simpleMasterClient, type SimpleMasterRow } from "./radiotherapy";

// ---- 警告(判断支援)の確認理由マスタ(docs/advisory-design.md §3.1) ----

export type AdvisoryOverrideReason = SimpleMasterRow;

export const advisoryOverrideReasonClient = simpleMasterClient<AdvisoryOverrideReason>(
  "/master/advisory_override_reasons",
);

// ---- 施設の規則(docs/advisory-design.md §3.6) ----

export type { AdvisoryRule } from "../../fhir/advisoryRuleHelpers";

export const advisoryRuleClient = simpleMasterClient<AdvisoryRule>("/master/advisory_rules");
