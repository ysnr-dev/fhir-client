import { useState } from "react";
import { Link } from "react-router-dom";
import type { CdsCard, CdsCardLink, CdsIndicator, CdsOverrideReason } from "../api/cdsClient";
import { overrideReasonsOf } from "../fhir/cdsCardHelpers";
import { KARTE_TAB_PARAM, KARTE_VIEW_PARAM } from "../karteUrl";
import { setPendingAppContext } from "../lib/smartAppLaunchContext";

// CDS Hooks のカードの一覧(docs/cds-hooks-design.md §3)。患者帯の吹き出し・処方フォームの
// order-select・登録前の確認モーダルで同じ見た目にする。

const INDICATOR_LABELS: Record<CdsIndicator, string> = {
  info: "情報",
  warning: "注意",
  critical: "重要",
};

interface CdsCardListProps {
  cards: CdsCard[];
  patientId: string;
  /** 理由を選んだとき。 */
  onOverride: (card: CdsCard, reason: CdsOverrideReason) => void;
  /** 選択中の理由(カードの uuid → 理由の code)。渡さなければ選んだら即時に onOverride だけ呼ぶ。 */
  overrides?: Record<string, string>;
  /** 理由の選択欄の先頭に出す文言。 */
  overridePlaceholder?: string;
  className?: string;
}

export function CdsCardList({
  cards,
  patientId,
  onOverride,
  overrides,
  overridePlaceholder = "無視…",
  className = "",
}: CdsCardListProps) {
  return (
    <ul className={`cds-cards ${className}`.trim()}>
      {cards.map((card) => (
        <CdsCardItem
          key={card.uuid}
          card={card}
          patientId={patientId}
          overrideCode={overrides?.[card.uuid] ?? ""}
          overridePlaceholder={overridePlaceholder}
          onOverride={(reason) => onOverride(card, reason)}
        />
      ))}
    </ul>
  );
}

function CdsCardItem({
  card,
  patientId,
  overrideCode,
  overridePlaceholder,
  onOverride,
}: {
  card: CdsCard;
  patientId: string;
  overrideCode: string;
  overridePlaceholder: string;
  onOverride: (reason: CdsOverrideReason) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const reasons = overrideReasonsOf(card);

  return (
    <li className={`cds-card cds-card--${card.indicator}`}>
      <div className="cds-card__head">
        <span className="cds-card__indicator" title={INDICATOR_LABELS[card.indicator]} />
        <span className="patient-header__popover-name cds-card__summary">{card.summary}</span>
      </div>
      <div className="cds-card__source">
        {card.source.url ? (
          <a href={card.source.url} target="_blank" rel="noopener noreferrer">
            {card.source.label}
          </a>
        ) : (
          card.source.label
        )}
        {card.source.topic && <span> / {card.source.topic}</span>}
      </div>
      {card.detail && (
        <>
          <button type="button" className="rp-card__compact-button" onClick={() => setDetailOpen((v) => !v)}>
            {detailOpen ? "詳細を閉じる" : "詳細"}
          </button>
          {detailOpen && <p className="cds-card__detail">{card.detail}</p>}
        </>
      )}
      {card.suggestions.length > 0 && (
        <ul className="cds-card__suggestions">
          {card.suggestions.map((suggestion, index) => (
            <li key={index}>
              {suggestion.label}
              {suggestion.actions.length > 0 && <span>({suggestion.actions.join("、")})</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="cds-card__actions">
        {card.links.map((link, index) => (
          <CdsCardLinkButton key={index} link={link} patientId={patientId} />
        ))}
        <select
          className="cds-card__override"
          aria-label="無視の理由"
          value={overrideCode}
          onChange={(e) => {
            const reason = reasons.find((r) => r.code === e.target.value);
            if (reason) onOverride(reason);
          }}
        >
          <option value="">{overridePlaceholder}</option>
          {reasons.map((reason) => (
            <option key={reason.code} value={reason.code}>
              {reason.display}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}

function CdsCardLinkButton({ link, patientId }: { link: CdsCardLink; patientId: string }) {
  if (link.type === "absolute") {
    return (
      <a className="button rp-card__compact-button cds-card__link" href={link.url} target="_blank" rel="noopener noreferrer">
        {link.label}
      </a>
    );
  }
  // smart: 登録済みのアプリだけ起動できる。アプリタブに切り替え、appContext は起動時に添える。
  if (link.smart_app_id == null) {
    return (
      <span className="button rp-card__compact-button cds-card__link cds-card__link--disabled" title="未登録のアプリ">
        {link.label}
      </span>
    );
  }
  const appId = link.smart_app_id;
  return (
    <Link
      className="button rp-card__compact-button cds-card__link"
      to={`/patients/${patientId}/karte?${KARTE_TAB_PARAM}=smart-apps&${KARTE_VIEW_PARAM}=${appId}`}
      onClick={() => {
        if (link.app_context) setPendingAppContext(appId, link.app_context);
      }}
    >
      {link.label}
    </Link>
  );
}
