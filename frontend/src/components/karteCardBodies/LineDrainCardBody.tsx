import {
  daysInsertedLabel,
  removalReasonLabel,
  siteObservationSummary,
  type LineDrainRecord,
} from "../../fhir/lineDrainHelpers";
import { dateTimeLabel, today } from "../../lib/dates";

/**
 * ライン・ドレーンのカードの本文。デバイス・留置日数(抜去済なら抜去日時と区分)・直近の刺入部観察。
 * 種別と部位は見出しに出す。
 */
export function LineDrainCardBody({ record }: { record: LineDrainRecord }) {
  const latest = record.observations[0];
  return (
    <>
      <p className="karte-adverse-event__context">
        {record.deviceLabel && <span>{record.deviceLabel}</span>}
        <span>{daysInsertedLabel(record, today())}</span>
        {record.removedAt && (
          <span>{`抜去 ${dateTimeLabel(record.removedAt)} ${removalReasonLabel(record.removalReason)}`.trim()}</span>
        )}
      </p>
      {record.purpose && <p className="karte-pathway-eval__text">{record.purpose}</p>}
      {record.note && <p className="karte-pathway-eval__text">{record.note}</p>}
      {latest && (
        <p className="karte-pathway-eval__text">{`観察 ${dateTimeLabel(latest.effectiveAt)}: ${siteObservationSummary(latest)}`}</p>
      )}
    </>
  );
}
