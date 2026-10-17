import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useOutpatientList } from "../../api/queries";
import {
  appointmentActorId,
  appointmentBookedTimeLabel,
  appointmentDepartmentLabel,
} from "../../fhir/appointmentHelpers";
import { homeOutpatientRows } from "../../fhir/homeSections";
import {
  EXAM_PAUSED_CODE,
  IN_EXAM_STATUS,
  outpatientStatusCode,
  outpatientStatusCounts,
  outpatientStatusLabel,
} from "../../fhir/outpatientEncounterHelpers";
import { displayName, patientNumberOf } from "../../fhir/patientHelpers";
import { useRowPictograms } from "../../hooks/useRowPictograms";
import { useReturnLinkState } from "../../returnTo";
import { ErrorBanner } from "../ErrorBanner";
import { RowPictograms } from "../PatientListRowParts";
import { PatientKana } from "../PatientRowCells";
import { HomeCardFrame, HomeCardLoading, HomeCardTruncated, type HomeCardProps } from "./shared";

const OUTPATIENT_ROWS = 8;

/** 診察待ちとして並べる状態。診療済・未来院は落とす。 */
const WAITING_STATUSES: readonly string[] = [
  "booked",
  "arrived",
  "checked-in",
  IN_EXAM_STATUS,
  EXAM_PAUSED_CODE,
];

/** 本日の外来。外来患者一覧と同じ hook で 1 日ぶんを読み、設定が「自分の予約」なら担当医で絞る。 */
export function OutpatientCard({ card, date, practitionerId, polling }: HomeCardProps<"outpatient">) {
  const mine = card.settings.scope === "mine" ? practitionerId : null;
  const outpatients = useOutpatientList(date, { polling });
  const linkState = useReturnLinkState();
  const rows = useMemo(
    () => homeOutpatientRows(outpatients.data?.rows ?? [], mine),
    [outpatients.data, mine],
  );
  const counts = useMemo(() => outpatientStatusCounts(rows), [rows]);
  const waiting = useMemo(
    () =>
      rows
        .filter((row) => WAITING_STATUSES.includes(outpatientStatusCode(row.appointment, row.encounter)))
        .sort((a, b) => (a.appointment.start ?? "").localeCompare(b.appointment.start ?? "")),
    [rows],
  );
  const patientIds = useMemo(
    () =>
      [
        ...new Set(
          waiting
            .slice(0, OUTPATIENT_ROWS)
            .map((row) => row.patient?.id ?? appointmentActorId(row.appointment, "Patient"))
            .filter((id): id is string => Boolean(id)),
        ),
      ],
    [waiting],
  );
  const pictograms = useRowPictograms(patientIds);
  const listLink = `/outpatients?date=${date}${mine ? `&practitioner=${mine}` : ""}`;

  return (
    <HomeCardFrame
      title={mine ? "本日の外来(自分の予約)" : "本日の外来"}
      link={{ to: listLink, label: "外来患者一覧" }}
    >
      <ErrorBanner error={outpatients.error} />
      {outpatients.isPending ? (
        <HomeCardLoading />
      ) : (
        <>
          <p className="home__counts">
            {counts.map((status) => (
              <span key={status.code} className="home__count">
                {status.label} <strong>{status.count}</strong>
              </span>
            ))}
          </p>
          {outpatients.data?.truncated && (
            <HomeCardTruncated>この日の予約が多いため、一部のみ表示しています。</HomeCardTruncated>
          )}
          {waiting.length === 0 ? (
            <p className="home__empty">診察待ちの患者はいません。</p>
          ) : (
            <div className="home__table-wrap">
              <table className="home__table">
                <thead>
                  <tr>
                    <th>予約時間</th>
                    <th>患者番号</th>
                    <th>患者氏名</th>
                    <th>診療科</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.slice(0, OUTPATIENT_ROWS).map((row) => {
                    const patientId = row.patient?.id ?? appointmentActorId(row.appointment, "Patient");
                    return (
                      <tr key={row.appointment.id}>
                        <td className="home__cell-compact">{appointmentBookedTimeLabel(row.appointment)}</td>
                        <td className="home__cell-compact">
                          {row.patient ? patientNumberOf(row.patient) : ""}
                        </td>
                        <td>
                          {row.patient && patientId ? (
                            <Link
                              className="home__row-link"
                              to={`/patients/${patientId}/karte`}
                              state={linkState}
                            >
                              {displayName(row.patient)}
                            </Link>
                          ) : (
                            "-"
                          )}
                          <PatientKana patient={row.patient} />
                          {patientId && <RowPictograms patientId={patientId} {...pictograms} />}
                        </td>
                        <td className="home__cell-compact">{appointmentDepartmentLabel(row.appointment)}</td>
                        <td className="home__cell-compact">
                          <span
                            className={`outpatient__status outpatient__status--${outpatientStatusCode(row.appointment, row.encounter)}`}
                          >
                            {outpatientStatusLabel(row.appointment, row.encounter)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {waiting.length > OUTPATIENT_ROWS && (
            <p className="home__more">
              <Link to={listLink}>他 {waiting.length - OUTPATIENT_ROWS} 件</Link>
            </p>
          )}
        </>
      )}
    </HomeCardFrame>
  );
}
