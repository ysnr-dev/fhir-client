import {
  type AdvisoryOverrideReason,
  type AdvisoryRule,
  advisoryOverrideReasonClient,
  advisoryRuleClient,
} from "../masterClient";
import { simpleMasterHooks } from "./radiotherapy";

// ---- 警告(判断支援)の確認理由マスタ ----

export const advisoryOverrideReasonHooks = simpleMasterHooks<AdvisoryOverrideReason>(
  "advisory_override_reasons",
  advisoryOverrideReasonClient,
);

/** 登録前の確認モーダルと CDS カードの無視に出す理由(有効な行だけ、表示順)。 */
export function useAdvisoryOverrideReasons(): AdvisoryOverrideReason[] {
  return advisoryOverrideReasonHooks.useOptions().items;
}

// ---- 施設の規則 ----

export const advisoryRuleHooks = simpleMasterHooks<AdvisoryRule>("advisory_rules", advisoryRuleClient);

/** フォームと患者帯で評価する規則(有効な行だけ)。 */
export function useAdvisoryRules(): AdvisoryRule[] {
  return advisoryRuleHooks.useOptions().items;
}
