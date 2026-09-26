import { Link } from "react-router-dom";
import { usePatientAdmission, usePatientBroughtMedications } from "../api/queries";
import {
  BROUGHT_STATE_LABELS,
  countBroughtStates,
  summarizeBroughtMedication,
} from "../fhir/broughtMedicationHelpers";
import { KARTE_TAB_PARAM } from "../karteUrl";
import { ErrorBanner } from "./ErrorBanner";

/** 要約に並べる薬剤の数。全部は持参薬タブで見る。 */
const PREVIEW_COUNT = 5;

/**
 * プロファイルタブの「持参薬」区画。入院中の患者だけ、今の入院の持参薬を要約して出す
 * (件数・未鑑別・未判断と先頭の数剤)。登録・鑑別・判断は持参薬タブで行う。
 */
export function PatientBroughtMedicationSection({ patientId }: { patientId: string }) {
  const admission = usePatientAdmission(patientId);
  const encounterId = admission.data?.encounter.id;
  const { statements, isLoading, error } = usePatientBroughtMedications(
    encounterId ? patientId : undefined,
    encounterId,
  );

  if (!encounterId) return null;

  const counts = countBroughtStates(statements);
  const tabLink = { search: `?${KARTE_TAB_PARAM}=brought-medication` };

  return (
    <section className="karte-profile__section">
      <div className="karte-tabpanel__header">
        <h3>持参薬</h3>
        <div className="karte-tabpanel__actions">
          <Link className="button" to={tabLink}>
            持参薬タブで開く
          </Link>
        </div>
      </div>

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : statements.length === 0 ? (
        <p className="patient-table__empty">今の入院の持参薬は登録されていません。</p>
      ) : (
        <>
          <p className="brought-med__summary">
            {counts.total} 剤
            {counts.unidentified > 0 && (
              <span className="brought-med__pending">未鑑別 {counts.unidentified}</span>
            )}
            {counts.undecided > 0 && (
              <span className="brought-med__pending">未判断 {counts.undecided}</span>
            )}
          </p>
          <ul className="brought-med__preview">
            {statements.slice(0, PREVIEW_COUNT).map((statement) => {
              const summary = summarizeBroughtMedication(statement);
              return (
                <li key={summary.id}>
                  {summary.name}
                  <span className={`brought-med__state brought-med__state--${summary.state}`}>
                    {BROUGHT_STATE_LABELS[summary.state]}
                  </span>
                </li>
              );
            })}
            {statements.length > PREVIEW_COUNT && <li>ほか {statements.length - PREVIEW_COUNT} 剤</li>}
          </ul>
        </>
      )}
    </section>
  );
}
