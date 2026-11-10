import { useDialysisChartSessionIds } from "../../api/queries";
import { summarizeDialysisOrder } from "../../fhir/dialysisOrderHelpers";
import { dialysisSessionLine, type DialysisSessionDisplay } from "../../fhir/dialysisResultHelpers";
import { DialysisChartMark } from "../DialysisChartMark";

/** カードに出す実施の件数。週 3 回を何か月も続けるので直近だけ出す。 */
const DIALYSIS_PERFORM_PREVIEW = 3;

// 透析は「浄化方法 + 曜日 × シフト」が見出し、透析条件が本文。期間はカードのタイトルに出る。
// 条件は項目名の列と値の列に分けて、薬剤名のような長い値が折り返しても項目の頭が揃うようにする。
// 実施を出す条件は karteTimeline.ts の dialysis 分岐が決めている(受付済以降は常に出す)。
export function DialysisOrderCardBody({
  serviceRequest,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  performs: DialysisSessionDisplay[];
}) {
  const summary = summarizeDialysisOrder(serviceRequest);
  // 経過表は開始以降の回にしか無いので、始めた回が無ければ読まない。
  const chartSessions = useDialysisChartSessionIds(
    performs.some((perform) => perform.status !== "preparation") ? serviceRequest.id : undefined,
  );

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
  const recent = performs.slice(0, DIALYSIS_PERFORM_PREVIEW);
  const completed = performs.filter((perform) => perform.status === "completed").length;

  return (
    <>
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
      {performs.length > 0 && (
        <section className="karte-perform">
          <div className="karte-perform__head">
            <span className="karte-perform__title">実施</span>
            <span className="karte-perform__meta">{completed}回</span>
          </div>
          {recent.map((perform) => (
            <div className="karte-perform__row" key={perform.id}>
              <span className="karte-perform__values">
                <span>{dialysisSessionLine(perform)}</span>
                {chartSessions.data?.ids.has(perform.id) && <DialysisChartMark />}
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
