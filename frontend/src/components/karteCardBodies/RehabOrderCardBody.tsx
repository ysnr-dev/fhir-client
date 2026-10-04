import { summarizeRehabOrder } from "../../fhir/rehabOrderHelpers";
import type { RehabPerformDisplay } from "../../fhir/rehabResultHelpers";

/** カードに出す実施履歴の件数。期間中に何十件も積み上がるので直近だけ出す。 */
const REHAB_PERFORM_PREVIEW = 3;

// リハビリは「区分 / 療法種別 / 期間 / 週N回・1回M単位」+ 実施履歴が本文。
//
// 実施履歴を出す条件は karteTimeline.ts の rehab 分岐が決めている(受付済以降は常に
// 出す。他部門は実施済のときだけ)。ここでは渡されたものをそのまま並べる。
export function RehabOrderCardBody({
  serviceRequest,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  performs: RehabPerformDisplay[];
}) {
  const summary = summarizeRehabOrder(serviceRequest);

  if (!summary.diseaseCategoryDisplay) {
    return <p className="karte-card__empty">疾患別リハ区分がありません。</p>;
  }

  const recent = performs.slice(0, REHAB_PERFORM_PREVIEW);
  const totalUnits = performs.reduce((sum, perform) => sum + (perform.units ?? 0), 0);

  return (
    <>
      <div className="karte-rp">
        <div className="karte-rp__head">
          <span className="karte-order__group-name">{summary.diseaseCategoryDisplay}</span>
          {summary.therapyTypesLabel && (
            <span className="karte-perform__meta">{summary.therapyTypesLabel}</span>
          )}
        </div>
        <ul className="karte-rp__medicines">
          <li>
            <span className="karte-rp__medicine-name">
              {summary.periodLabel}
              {summary.scheduleLabel && ` / ${summary.scheduleLabel}`}
            </span>
          </li>
          {summary.targetDisease && (
            <li>
              <span className="karte-rp__medicine-name">対象: {summary.targetDisease}</span>
            </li>
          )}
        </ul>
        {summary.comment && <p className="karte-perform__note">{summary.comment}</p>}
      </div>
      {performs.length > 0 && (
        <section className="karte-perform">
          <div className="karte-perform__head">
            <span className="karte-perform__title">実施</span>
            <span className="karte-perform__meta">
              {performs.length}回 計{totalUnits}単位
            </span>
          </div>
          {recent.map((perform) => (
            <div className="karte-perform__row" key={perform.id}>
              <span className="karte-perform__values">
                <span>{perform.label}</span>
                {perform.note && <span>{perform.note}</span>}
              </span>
            </div>
          ))}
          {/* 直近ぶんしか出していないことを黙って隠さない(全件は詳細で見る)。 */}
          {performs.length > recent.length && (
            <p className="karte-perform__note">
              ほか {performs.length - recent.length} 件(詳細で全件を表示)
            </p>
          )}
        </section>
      )}
    </>
  );
}
