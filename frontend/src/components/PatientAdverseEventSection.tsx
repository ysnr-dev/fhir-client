import { useState } from "react";
import { usePatientAdverseEvents } from "../api/queries";
import {
  adverseEventTreatmentLabel,
  sortAdverseEventsForReview,
  type AdverseEventRecord,
} from "../fhir/adverseEventHelpers";
import { AdverseEventRecoveryModal } from "./AdverseEventRecoveryModal";
import { ErrorBanner } from "./ErrorBanner";

/**
 * プロファイルタブの「有害事象」区画。化学療法・放射線治療で記録した有害事象(CTCAE Grade)を
 * 治療をまたいで読む(docs/chemo-regimen-design.md §8.27)。
 *
 * 既定は継続中(回復日が無い)だけ。ここで入れられるのは継続中の記録の回復(モーダル)だけで、
 * 用語・Grade・発現日の編集と削除は治療の側(化学療法タブ・放射線治療の治療処方)で行う。
 */
export function PatientAdverseEventSection({ patientId }: { patientId: string }) {
  const [ongoingOnly, setOngoingOnly] = useState(true);
  const [recovering, setRecovering] = useState<AdverseEventRecord | null>(null);
  const { data, isLoading, error } = usePatientAdverseEvents(patientId);

  const rows = sortAdverseEventsForReview((data ?? []).filter((r) => !ongoingOnly || !r.resolved));

  return (
    <section className="karte-profile__section">
      <div className="karte-tabpanel__header">
        <h3>有害事象</h3>
        <div className="karte-tabpanel__actions">
          <label className="profile-tab__toggle">
            <input type="checkbox" checked={!ongoingOnly} onChange={(e) => setOngoingOnly(!e.target.checked)} />
            回復したものも表示
          </label>
        </div>
      </div>

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="patient-table__empty">
          {ongoingOnly ? "継続中の有害事象はありません。" : "有害事象の記録がありません。"}
        </p>
      ) : (
        <ul className="regimen-adverse__list">
          {rows.map((row) => {
            const meta = [adverseEventTreatmentLabel(row), row.performer?.display].filter(Boolean).join(" ・ ");
            return (
              <li key={row.id} className="regimen-adverse__item">
                <span className={`regimen-adverse__grade regimen-adverse__grade--${row.grade}`}>G{row.grade}</span>
                <span className="regimen-adverse__term">{row.term}</span>
                <span className="regimen-adverse__period">
                  {row.onset || "-"}
                  {row.resolved ? ` 〜 ${row.resolved}` : " 〜（継続中）"}
                </span>
                {!row.resolved && (
                  <span className="regimen-adverse__actions">
                    <button type="button" className="rp-card__compact-button" onClick={() => setRecovering(row)}>
                      回復
                    </button>
                  </span>
                )}
                {meta && <span className="regimen-adverse__meta">{meta}</span>}
                {row.note && <span className="regimen-adverse__note">{row.note}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {recovering && (
        <AdverseEventRecoveryModal patientId={patientId} record={recovering} onClose={() => setRecovering(null)} />
      )}
    </section>
  );
}
