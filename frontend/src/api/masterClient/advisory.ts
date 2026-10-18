import { simpleMasterClient, type SimpleMasterRow } from "./radiotherapy";

// ---- 警告(判断支援)の確認理由マスタ(docs/advisory-design.md §3.1) ----

export type AdvisoryOverrideReason = SimpleMasterRow;

export const advisoryOverrideReasonClient = simpleMasterClient<AdvisoryOverrideReason>(
  "/master/advisory_override_reasons",
);
