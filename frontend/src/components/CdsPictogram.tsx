import { useState } from "react";
import { Link } from "react-router-dom";
import { useCdsFeedback, useCdsPatientView } from "../api/cdsQueries";
import type { CdsCard, CdsCardLink, CdsIndicator, CdsOverrideReason } from "../api/cdsClient";
import { KARTE_TAB_PARAM, KARTE_VIEW_PARAM } from "../karteUrl";
import { setPendingAppContext } from "../lib/smartAppLaunchContext";
import { CautionPictogram } from "./icons/cautionPictograms";
import { PictogramPopover } from "./PictogramPopover";

// 患者帯の「判断支援」ピクトグラム(docs/cds-hooks-design.md §3.1)。カルテを開いたときに
// 外部の CDS サービスが返したカードを吹き出しに並べる。カードが無ければ何も出さない。

const HEADER_PICTOGRAM_SIZE = 20;

const INDICATOR_RANK: Record<CdsIndicator, number> = { info: 0, warning: 1, critical: 2 };

const INDICATOR_LABELS: Record<CdsIndicator, string> = {
  info: "情報",
  warning: "注意",
  critical: "重要",
};

/** サービスが無視理由の候補を示さないときの既定。 */
const DEFAULT_OVERRIDE_REASONS: CdsOverrideReason[] = [
  { code: "already-addressed", system: "http://fhir-client.local/CodeSystem/cds-override-reason", display: "対応済み" },
  { code: "not-applicable", system: "http://fhir-client.local/CodeSystem/cds-override-reason", display: "該当しない" },
  { code: "clinical-judgement", system: "http://fhir-client.local/CodeSystem/cds-override-reason", display: "臨床判断で不要" },
  { code: "other", system: "http://fhir-client.local/CodeSystem/cds-override-reason", display: "その他" },
];

interface CdsPictogramProps {
  patientId: string | undefined;
  size?: number;
  portal?: boolean;
  /** 外来の診察中の受診。起動の文脈として渡す。 */
  encounterId?: string;
}

export function CdsPictogram({ patientId, size = HEADER_PICTOGRAM_SIZE, portal, encounterId }: CdsPictogramProps) {
  const result = useCdsPatientView(patientId, encounterId);
  const feedback = useCdsFeedback(patientId, encounterId);
  const cards = result.data?.cards ?? [];
  if (!patientId || cards.length === 0) return null;

  const worst = cards.reduce<CdsIndicator>(
    (acc, card) => (INDICATOR_RANK[card.indicator] > INDICATOR_RANK[acc] ? card.indicator : acc),
    "info",
  );

  return (
    <span className="patient-header__item patient-header__cautions">
      <PictogramPopover
        label={`判断支援 ${cards.length} 件`}
        className={`patient-header__caution--cds-${worst}`}
        icon={<CautionPictogram pictogram="cds" size={size} />}
        count={cards.length}
        portal={portal}
        closeOnClick={false}
      >
        <ul className="patient-header__popover-list cds-cards">
          {cards.map((card) => (
            <CdsCardItem
              key={card.uuid}
              card={card}
              patientId={patientId}
              onOverride={(reason) =>
                feedback.mutate({
                  service_id: card.service.id,
                  service: card.service.service,
                  card: card.uuid,
                  outcome: "overridden",
                  override_reason: { code: reason.code, system: reason.system },
                })
              }
            />
          ))}
        </ul>
      </PictogramPopover>
    </span>
  );
}

function CdsCardItem({
  card,
  patientId,
  onOverride,
}: {
  card: CdsCard;
  patientId: string;
  onOverride: (reason: CdsOverrideReason) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const reasons = card.override_reasons.length > 0 ? card.override_reasons : DEFAULT_OVERRIDE_REASONS;

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
          value=""
          onChange={(e) => {
            const reason = reasons.find((r) => r.code === e.target.value);
            if (reason) onOverride(reason);
          }}
        >
          <option value="">無視…</option>
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
