import { summarizeConsultOrder } from "../../fhir/consultOrderHelpers";

// 他科依頼は「依頼種別 / 依頼目的 / 補足」+ 回答済なら回答者が本文。
//
// 回答の本文はここに出さない。回答は診療記録として独立したカードにもなるので、
// 同じ文章を 2 か所に出すと読むときにどちらが正本か分からなくなる
// (docs/consult-order-design.md §5)。ここからはケバブメニューの「回答表示」で開く。
export function ConsultOrderCardBody({ serviceRequest }: { serviceRequest: fhir4.ServiceRequest }) {
  const summary = summarizeConsultOrder(serviceRequest);

  if (!summary.targetDepartmentId) {
    return <p className="karte-card__empty">依頼先の診療科がありません。</p>;
  }

  return (
    <div className="karte-rp">
      <div className="karte-rp__head">
        <span className="karte-order__group-name">{summary.requestTypeDisplay}</span>
        {summary.urgent && <span className="micro-result__badge">至急</span>}
        {summary.replyId && (
          <span className="micro-result__badge micro-result__badge--muted">回答済</span>
        )}
      </div>
      {/* 依頼目的は複数行で書かれるので改行を残す。 */}
      <p className="karte-perform__note consult-card__purpose">{summary.purpose || "(目的の記載なし)"}</p>
      {summary.comment && <p className="karte-perform__note">{summary.comment}</p>}
    </div>
  );
}
