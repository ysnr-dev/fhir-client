import { type AdvisoryOverrideReason, advisoryOverrideReasonClient } from "../masterClient";
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
