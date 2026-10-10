import { summarizeTeamRequest } from "../../fhir/teamRequestHelpers";

// チーム依頼は「チームの区分 / 依頼目的 / 補足」が本文。回診記録は診療記録として独立した
// カードにもなるので、ここには出さない(ケバブの「回診記録表示」で最後の記録を開く)。
export function TeamRequestCardBody({ serviceRequest }: { serviceRequest: fhir4.ServiceRequest }) {
  const summary = summarizeTeamRequest(serviceRequest);

  if (!summary.teamId) {
    return <p className="karte-card__empty">依頼先のチームがありません。</p>;
  }

  return (
    <div className="karte-rp">
      <div className="karte-rp__head">
        <span className="karte-order__group-name">{summary.teamKindDisplay}</span>
        {summary.urgent && <span className="micro-result__badge">至急</span>}
        {summary.lastRoundId && <span className="micro-result__badge micro-result__badge--muted">回診あり</span>}
      </div>
      <p className="karte-perform__note consult-card__purpose">{summary.purpose || "(目的の記載なし)"}</p>
      {summary.comment && <p className="karte-perform__note">{summary.comment}</p>}
    </div>
  );
}
