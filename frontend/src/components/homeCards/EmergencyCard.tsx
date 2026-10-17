import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useEmergencyList } from "../../api/queries";
import {
  emergencyStatusLabel,
  emergencyStatusSince,
  emergencyTriageLevel,
  isEmergencyActive,
  jtasLabel,
} from "../../fhir/emergencyEncounterHelpers";
import { displayName, patientNumberOf } from "../../fhir/patientHelpers";
import { dateTimeSecondsLabel } from "../../lib/dates";
import { useReturnLinkState } from "../../returnTo";
import { ErrorBanner } from "../ErrorBanner";
import { PatientKana } from "../PatientRowCells";
import { HomeCardFrame, HomeCardLoading, HomeCardTruncated, type HomeCardProps } from "./shared";

const EMERGENCY_ROWS = 8;

/** 救急。救急患者一覧と同じ hook で読み、いま滞在している(来院〜診療中)患者を並べる。 */
export function EmergencyCard({ date, polling }: HomeCardProps<"emergency">) {
  const list = useEmergencyList(date, { polling });
  const linkState = useReturnLinkState();
  const active = useMemo(
    () => (list.data?.rows ?? []).filter((row) => isEmergencyActive(row.encounter)),
    [list.data],
  );
  const todayCount = list.data?.rows.length ?? 0;

  return (
    <HomeCardFrame title="救急" link={{ to: "/emergency", label: "救急患者一覧" }}>
      <ErrorBanner error={list.error} />
      {list.isPending ? (
        <HomeCardLoading />
      ) : (
        <>
          <p className="home__counts">
            <span className="home__count home__count--big">
              滞在中 <strong>{active.length}</strong>
            </span>
            <span className="home__count">
              本日来院 <strong>{todayCount}</strong>
            </span>
          </p>
          {list.data?.truncated && <HomeCardTruncated>件数が多いため、一部のみ表示しています。</HomeCardTruncated>}
          {active.length === 0 ? (
            <p className="home__empty">滞在中の救急患者はいません。</p>
          ) : (
            <div className="home__table-wrap">
              <table className="home__table">
                <thead>
                  <tr>
                    <th>状態</th>
                    <th>トリアージ</th>
                    <th>患者番号</th>
                    <th>患者氏名</th>
                    <th>経過</th>
                  </tr>
                </thead>
                <tbody>
                  {active.slice(0, EMERGENCY_ROWS).map(({ encounter, patient }) => {
                    const patientId = patient?.id ?? encounter.subject?.reference?.split("/").pop();
                    const since = emergencyStatusSince(encounter);
                    return (
                      <tr key={encounter.id}>
                        <td className="home__cell-compact">{emergencyStatusLabel(encounter.status)}</td>
                        <td className="home__cell-compact">{jtasLabel(emergencyTriageLevel(encounter))}</td>
                        <td className="home__cell-compact">{patient ? patientNumberOf(patient) : ""}</td>
                        <td>
                          {patient && patientId ? (
                            <Link className="home__row-link" to={`/patients/${patientId}/karte`} state={linkState}>
                              {displayName(patient)}
                            </Link>
                          ) : (
                            "-"
                          )}
                          <PatientKana patient={patient} />
                        </td>
                        <td className="home__cell-compact">{since ? dateTimeSecondsLabel(since) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {active.length > EMERGENCY_ROWS && (
            <p className="home__more">
              <Link to="/emergency">他 {active.length - EMERGENCY_ROWS} 件</Link>
            </p>
          )}
        </>
      )}
    </HomeCardFrame>
  );
}
