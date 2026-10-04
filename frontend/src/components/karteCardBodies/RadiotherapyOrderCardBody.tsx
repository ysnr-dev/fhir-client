import { formatDose, summarizeRadiotherapyOrder } from "../../fhir/radiotherapyOrderHelpers";
import {
  radiotherapyProgress,
  type RadiotherapyFractionDisplay,
} from "../../fhir/radiotherapyResultHelpers";

// 放射線治療の治療処方。部位と「標的ごとのコース合計」が処方の要点で、Phase の内訳は
// 詳細で見る(docs/radiotherapy-order-design.md §5)。
const RADIOTHERAPY_FRACTION_PREVIEW = 3;

export function RadiotherapyOrderCardBody({
  serviceRequest,
  fractions,
  hasCourseSummary,
}: {
  serviceRequest: fhir4.ServiceRequest;
  fractions: RadiotherapyFractionDisplay[];
  hasCourseSummary: boolean;
}) {
  const summary = summarizeRadiotherapyOrder(serviceRequest);
  const progress = radiotherapyProgress(summary, fractions);
  // カードに並べるのは実績(照射した回・照射しなかった回)だけ。予定は件数と次回の日付で出す。
  const records = fractions.filter((fraction) => !fraction.planned);
  const recent = records.slice(0, RADIOTHERAPY_FRACTION_PREVIEW);

  return (
    <>
    <div className="karte-rp">
      <div className="karte-rp__head">
        <span className="karte-order__group-name">{summary.siteLabel || "(部位の記載なし)"}</span>
        {summary.techniqueLabel && (
          <span className="micro-result__badge micro-result__badge--muted">
            {summary.techniqueLabel}
          </span>
        )}
        {/* サマリーの本文は詳細で読む(カードに載せると長すぎる)。 */}
        {hasCourseSummary && (
          <span className="micro-result__badge micro-result__badge--muted">サマリーあり</span>
        )}
        {summary.concurrentTherapyDisplay && (
          <span className="micro-result__badge micro-result__badge--muted">
            {summary.concurrentTherapyDisplay}
          </span>
        )}
      </div>
      {summary.volumes
        .filter((volume) => volume.doseLabel)
        .map((volume) => (
          <p key={volume.volumeId} className="karte-perform__note">
            {volume.label} {volume.doseLabel}
          </p>
        ))}
      {summary.suspendedOn && (
        <p className="karte-perform__note">
          休止 {summary.suspendedOn}
          {summary.suspensionReason && ` ${summary.suspensionReason}`}
        </p>
      )}
      {summary.endedOn && (
        <p className="karte-perform__note">
          {serviceRequest.status === "revoked" ? "中止" : "終了"} {summary.endedOn}
          {summary.terminationReason && ` ${summary.terminationReason}`}
        </p>
      )}
      {summary.comment && <p className="karte-perform__note">{summary.comment}</p>}
    </div>
    {/* 照射の進み具合。1 コースで数十回になるので、直近ぶんと累積線量だけを出す。 */}
    {fractions.length > 0 && (
      <section className="karte-perform">
        <div className="karte-perform__head">
          <span className="karte-perform__title">照射</span>
          <span className="karte-perform__meta">
            {progress.fractionLabel}
            {progress.volumes.length > 0 &&
              ` 累積 ${progress.volumes
                .map((volume) => `${volume.label} ${formatDose(volume.deliveredDose)} Gy`)
                .join("、")}`}
            {progress.planned > 0 && ` 予定 ${progress.planned} 回（次回 ${progress.nextPlannedDate}）`}
          </span>
        </div>
        {recent.map((fraction) => (
          <div className="karte-perform__row" key={fraction.id}>
            <span className="karte-perform__values">
              <span>{fraction.label}</span>
              {fraction.notDoneReason && <span>{fraction.notDoneReason}</span>}
              {fraction.note && <span>{fraction.note}</span>}
            </span>
          </div>
        ))}
        {records.length > recent.length && (
          <p className="karte-perform__note">
            ほか {records.length - recent.length} 件(詳細で全件を表示)
          </p>
        )}
      </section>
    )}
    </>
  );
}
