import { summarizeNutritionGuidanceOrder } from "../../fhir/nutritionGuidanceOrderHelpers";
import type { NutritionGuidancePerformDisplay } from "../../fhir/nutritionGuidanceResultHelpers";

/** カードに出す実施履歴の件数。期間中に積み上がるので直近だけ出す。 */
const NUTRITION_GUIDANCE_PERFORM_PREVIEW = 3;

// 栄養指導は「指導形態 / 期間 / 対象疾患・指示食種」+ 実施履歴が本文。
//
// 実施履歴を出す条件は karteTimeline.ts の栄養指導分岐が決めている(リハビリと同じで
// 受付済以降は常に出す)。ここでは渡されたものをそのまま並べる。
export function NutritionGuidanceOrderCardBody({
  serviceRequest,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  performs: NutritionGuidancePerformDisplay[];
}) {
  const summary = summarizeNutritionGuidanceOrder(serviceRequest);

  if (!summary.formatDisplay) {
    return <p className="karte-card__empty">指導形態がありません。</p>;
  }

  const recent = performs.slice(0, NUTRITION_GUIDANCE_PERFORM_PREVIEW);
  const totalMinutes = performs.reduce((sum, perform) => sum + (perform.minutes ?? 0), 0);

  return (
    <>
      <div className="karte-rp">
        <div className="karte-rp__head">
          <span className="karte-order__group-name">{summary.formatDisplay}</span>
        </div>
        <ul className="karte-rp__medicines">
          <li>
            <span className="karte-rp__medicine-name">{summary.periodLabel}</span>
          </li>
          {summary.targetDisease && (
            <li>
              <span className="karte-rp__medicine-name">
                対象: {summary.targetDisease}
                {summary.targetDiet && ` / ${summary.targetDiet}`}
              </span>
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
            <span className="karte-perform__meta">
              {performs.length}回 計{totalMinutes}分
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
