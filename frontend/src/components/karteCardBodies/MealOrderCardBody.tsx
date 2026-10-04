import { summarizeMealOrder } from "../../fhir/mealOrderHelpers";

// 食事は明細を持たないので、食種 1 行(+主食)とコメントだけの簡素なカード。
// 期間はカードのタイトルに出るのでここには出さない。
export function MealOrderCardBody({ serviceRequest }: { serviceRequest: fhir4.ServiceRequest }) {
  const summary = summarizeMealOrder(serviceRequest);

  if (!summary.dietName) {
    return <p className="karte-card__empty">食種がありません。</p>;
  }

  return (
    <div className="karte-rp">
      <div className="karte-rp__head">
        <span className="karte-order__group-name">{summary.dietName}</span>
      </div>
      {/* 全食同じ主食なら 1 行、朝昼夕で違う(欠食を含む)なら 3 行に分けて出す。 */}
      {summary.stapleName && (
        <ul className="karte-rp__medicines">
          <li>
            <span className="karte-rp__medicine-name">主食: {summary.stapleName}</span>
          </li>
        </ul>
      )}
      {summary.stapleLines.length > 0 && (
        <ul className="karte-rp__medicines">
          {summary.stapleLines.map((line) => (
            <li key={line.timingDisplay}>
              <span className="karte-rp__medicine-name">
                {line.timingDisplay}: {line.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* 副食形態・塩分制限は指定のあるオーダーだけ。主食の下に 1 行ずつ足す。 */}
      {(summary.sideDishFormName || summary.saltLimitLabel) && (
        <ul className="karte-rp__medicines">
          {summary.sideDishFormName && (
            <li>
              <span className="karte-rp__medicine-name">副食形態: {summary.sideDishFormName}</span>
            </li>
          )}
          {summary.saltLimitLabel && (
            <li>
              <span className="karte-rp__medicine-name">塩分制限: {summary.saltLimitLabel}</span>
            </li>
          )}
        </ul>
      )}
      {summary.comment && <p className="karte-perform__note">{summary.comment}</p>}
    </div>
  );
}
