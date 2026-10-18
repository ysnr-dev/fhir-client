import type { CdsCard, CdsIndicator, CdsOverrideReason } from "../api/cdsClient";
import type { AdvisoryOverrideReason } from "../api/masterClient";
import { type Advisory, ADVISORY_OVERRIDE_REASON_SYSTEM, type AdvisoryKind, advisoryKey, severityOf } from "./advisoryHelpers";

// CDS Hooks のカードの判定(docs/cds-hooks-design.md)。

export const CDS_INDICATOR_RANK: Record<CdsIndicator, number> = { info: 0, warning: 1, critical: 2 };

/** マスタ(警告の確認理由)が読めないときの最後の既定。 */
const FALLBACK_OVERRIDE_REASONS: CdsOverrideReason[] = [
  { code: "already-addressed", system: ADVISORY_OVERRIDE_REASON_SYSTEM, display: "対応済み" },
  { code: "not-applicable", system: ADVISORY_OVERRIDE_REASON_SYSTEM, display: "該当しない" },
  { code: "clinical-judgement", system: ADVISORY_OVERRIDE_REASON_SYSTEM, display: "臨床判断で不要" },
  { code: "other", system: ADVISORY_OVERRIDE_REASON_SYSTEM, display: "その他" },
];

/**
 * カードの無視理由の候補。サービスが示せばそれ、無ければマスタ(警告の確認理由)。
 * マスタが空(読めない・未投入)なら最後の既定。
 */
export function overrideReasonsOf(card: CdsCard, masterReasons: AdvisoryOverrideReason[] = []): CdsOverrideReason[] {
  if (card.override_reasons.length > 0) return card.override_reasons;
  if (masterReasons.length > 0) {
    return masterReasons.map((reason) => ({
      code: reason.code,
      system: ADVISORY_OVERRIDE_REASON_SYSTEM,
      display: reason.name,
    }));
  }
  return FALLBACK_OVERRIDE_REASONS;
}

const CDS_ADVISORY_KIND: Record<CdsIndicator, AdvisoryKind> = {
  info: "cds-info",
  warning: "cds-warning",
  critical: "cds-critical",
};

/** カードを共通の警告に写す。重要(critical)だけ確認を要し、注意・情報は表示のみ。 */
export function cdsCardAdvisories(cards: CdsCard[]): Advisory[] {
  return cards.map((card) => {
    const kind = CDS_ADVISORY_KIND[card.indicator];
    return {
      key: advisoryKey(kind, card.uuid),
      kind,
      severity: severityOf(kind, true),
      message: card.summary,
      detail: card.detail ?? undefined,
      source: { label: card.source.label, url: card.source.url },
    };
  });
}

/** 警告の key(`cdsCardAdvisories` が付けたもの)からカードを引く。 */
export function cdsCardOfAdvisory(cards: CdsCard[], advisory: Advisory): CdsCard | undefined {
  return cards.find((card) => advisoryKey(CDS_ADVISORY_KIND[card.indicator], card.uuid) === advisory.key);
}

/** 最も重い指標。 */
export function worstIndicator(cards: CdsCard[]): CdsIndicator {
  return cards.reduce<CdsIndicator>(
    (acc, card) => (CDS_INDICATOR_RANK[card.indicator] > CDS_INDICATOR_RANK[acc] ? card.indicator : acc),
    "info",
  );
}
