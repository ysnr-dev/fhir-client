import type { CdsCard, CdsIndicator, CdsOverrideReason } from "../api/cdsClient";

// CDS Hooks のカードの判定(docs/cds-hooks-design.md)。

export const CDS_INDICATOR_RANK: Record<CdsIndicator, number> = { info: 0, warning: 1, critical: 2 };

/** サービスが無視理由の候補を示さないときの既定。 */
const DEFAULT_OVERRIDE_REASONS: CdsOverrideReason[] = [
  { code: "already-addressed", system: "http://fhir-client.local/CodeSystem/cds-override-reason", display: "対応済み" },
  { code: "not-applicable", system: "http://fhir-client.local/CodeSystem/cds-override-reason", display: "該当しない" },
  { code: "clinical-judgement", system: "http://fhir-client.local/CodeSystem/cds-override-reason", display: "臨床判断で不要" },
  { code: "other", system: "http://fhir-client.local/CodeSystem/cds-override-reason", display: "その他" },
];

export function overrideReasonsOf(card: CdsCard): CdsOverrideReason[] {
  return card.override_reasons.length > 0 ? card.override_reasons : DEFAULT_OVERRIDE_REASONS;
}

/** 最も重い指標。 */
export function worstIndicator(cards: CdsCard[]): CdsIndicator {
  return cards.reduce<CdsIndicator>(
    (acc, card) => (CDS_INDICATOR_RANK[card.indicator] > CDS_INDICATOR_RANK[acc] ? card.indicator : acc),
    "info",
  );
}
