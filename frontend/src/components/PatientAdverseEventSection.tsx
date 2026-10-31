import { useState } from "react";
import { usePatientAdverseEvents } from "../api/queries";
import {
  adverseEventTreatmentLabel,
  sortAdverseEventsForReview,
} from "../fhir/adverseEventHelpers";
import { ErrorBanner } from "./ErrorBanner";

/**
 * プロファイルタブの「有害事象」区画。化学療法・放射線治療で記録した有害事象(CTCAE Grade)を
 * 治療をまたいで読む(docs/chemo-regimen-design.md §8.27)。
 *
 * 既定は継続中(回復日が無い)だけ。記録と編集は治療の側(化学療法タブ・放射線治療の治療処方)で行い、
 * ここは参照だけにする(同じ記録を 2 経路で直させない)。
 */
export function PatientAdverseEventSection({ patientId }: { patientId: string }) {
  const [ongoingOnly, setOngoingOnly] = useState(true);
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
        <table className="patient-table">
          <thead>
            <tr>
              <th>用語</th>
              <th className="rad-code__compact">Grade</th>
              <th className="rad-code__compact">発現日</th>
              <th className="rad-code__compact">回復日</th>
              <th>治療</th>
              <th>対処・経過</th>
              <th className="rad-code__compact">記録者</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.term}</td>
                <td className="rad-code__compact">
                  <span className={`regimen-adverse__grade regimen-adverse__grade--${row.grade}`}>G{row.grade}</span>
                </td>
                <td className="rad-code__compact">{row.onset || "-"}</td>
                <td className="rad-code__compact">
                  {row.resolved || <span className="regimen-adverse__ongoing">継続</span>}
                </td>
                <td>{adverseEventTreatmentLabel(row) || "-"}</td>
                <td>{row.note || "-"}</td>
                <td className="rad-code__compact">{row.performer?.display || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
