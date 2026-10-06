import { summarizeMedicationGuidanceOrder } from "../../fhir/medicationGuidanceOrderHelpers";
import type { MedicationGuidancePerformDisplay } from "../../fhir/medicationGuidanceResultHelpers";

/** カードに出す実施履歴の件数。期間中に積み上がるので直近だけ出す。 */
const PERFORM_PREVIEW = 3;

// 服薬指導は「指導区分 / 期間 / 指導条件・対象薬剤」+ 実施履歴が本文(栄養指導と同じ形)。
// 実施履歴を出す条件は karteTimeline.ts が決めている(受付済以降は常に出す)。
export function MedicationGuidanceOrderCardBody({
  serviceRequest,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  performs: MedicationGuidancePerformDisplay[];
}) {
  const summary = summarizeMedicationGuidanceOrder(serviceRequest);
  if (!summary.kindDisplay) return <p className="karte-card__empty">指導区分がありません。</p>;

  const recent = performs.slice(0, PERFORM_PREVIEW);
  return (
    <>
      <div className="karte-rp">
        <div className="karte-rp__head">
          <span className="karte-order__group-name">{summary.kindDisplay}</span>
        </div>
        <ul className="karte-rp__medicines">
          <li>
            <span className="karte-rp__medicine-name">{summary.periodLabel}</span>
          </li>
          {summary.conditionsLabel && (
            <li>
              <span className="karte-rp__medicine-name">条件: {summary.conditionsLabel}</span>
            </li>
          )}
          {summary.targetDrugs && (
            <li>
              <span className="karte-rp__medicine-name">対象薬剤: {summary.targetDrugs}</span>
            </li>
          )}
        </ul>
        {summary.purpose && <p className="karte-perform__note">{summary.purpose}</p>}
        {summary.comment && <p className="karte-perform__note">{summary.comment}</p>}
      </div>
      {performs.length > 0 && (
        <section className="karte-perform">
          <div className="karte-perform__head">
            <span className="karte-perform__title">実施</span>
            <span className="karte-perform__meta">{performs.length}回</span>
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
            <p className="karte-perform__note">ほか {performs.length - recent.length} 件(詳細で全件を表示)</p>
          )}
        </section>
      )}
    </>
  );
}
