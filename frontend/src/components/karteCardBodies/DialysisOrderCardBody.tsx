import { summarizeDialysisOrder } from "../../fhir/dialysisOrderHelpers";

// 透析は「浄化方法 / 曜日 × シフト / 主要な条件」が本文。期間はカードのタイトルに出る。
export function DialysisOrderCardBody({ serviceRequest }: { serviceRequest: fhir4.ServiceRequest }) {
  const summary = summarizeDialysisOrder(serviceRequest);

  if (!summary.modality) {
    return <p className="karte-card__empty">浄化方法がありません。</p>;
  }

  return (
    <div className="karte-rp">
      <div className="karte-rp__head">
        <span className="karte-order__group-name">{summary.modalityDisplay}</span>
        {summary.scheduleLabel && <span className="karte-perform__meta">{summary.scheduleLabel}</span>}
      </div>
      <ul className="karte-rp__medicines">
        {summary.conditionLabel && (
          <li>
            <span className="karte-rp__medicine-name">{summary.conditionLabel}</span>
          </li>
        )}
        {summary.purifierNames.length > 0 && (
          <li>
            <span className="karte-rp__medicine-name">血液浄化器: {summary.purifierNames.join(" / ")}</span>
          </li>
        )}
        {summary.anticoagulantName && (
          <li>
            <span className="karte-rp__medicine-name">
              抗凝固薬: {[summary.anticoagulantName, summary.anticoagulantDoseLabel].filter(Boolean).join(" ")}
            </span>
          </li>
        )}
        {summary.accessLabel && (
          <li>
            <span className="karte-rp__medicine-name">アクセス: {summary.accessLabel}</span>
          </li>
        )}
      </ul>
      {summary.comment && <p className="karte-perform__note">{summary.comment}</p>}
    </div>
  );
}
