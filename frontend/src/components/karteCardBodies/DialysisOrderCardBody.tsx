import { summarizeDialysisOrder } from "../../fhir/dialysisOrderHelpers";

// 透析は「浄化方法 + 曜日 × シフト」が見出し、透析条件が本文。期間はカードのタイトルに出る。
// 条件は項目名の列と値の列に分けて、薬剤名のような長い値が折り返しても項目の頭が揃うようにする。
export function DialysisOrderCardBody({ serviceRequest }: { serviceRequest: fhir4.ServiceRequest }) {
  const summary = summarizeDialysisOrder(serviceRequest);

  if (!summary.modality) {
    return <p className="karte-card__empty">浄化方法がありません。</p>;
  }

  const withVolume = (name: string, volume: string) => [name, volume].filter(Boolean).join(" ");
  const fields: [string, string][] = [
    ["条件", summary.conditionLabel],
    ["浄化器", summary.purifierNames.join(" / ")],
    ["透析液", summary.dialysate],
    ["補充液", withVolume(summary.substitutionFluid, summary.substitutionVolumeLabel)],
    ["置換液", withVolume(summary.replacementFluid, summary.replacementVolumeLabel)],
    ["抗凝固薬", [summary.anticoagulantName, summary.anticoagulantDoseLabel].filter(Boolean).join(" ")],
    ["アクセス", summary.accessLabel],
  ];
  const shown = fields.filter(([, value]) => value);

  return (
    <div className="karte-rp">
      <div className="karte-dialysis__head">
        <span className="karte-dialysis__modality">{summary.modalityDisplay}</span>
        {summary.scheduleLabel && <span className="karte-dialysis__schedule">{summary.scheduleLabel}</span>}
      </div>
      {shown.length > 0 && (
        <dl className="karte-dialysis__fields">
          {shown.map(([label, value]) => (
            <div key={label} className="karte-dialysis__field">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {summary.comment && <p className="karte-perform__note">{summary.comment}</p>}
    </div>
  );
}
