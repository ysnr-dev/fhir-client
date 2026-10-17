import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMyNursingAssignments } from "../../api/masterQueries";
import { useBedWardIndex, useInpatientEncounters, useNursingPendingCounts } from "../../api/queries";
import {
  encounterAdmissionDate,
  encounterAttendingName,
  encounterDepartmentName,
  encounterNurseNames,
} from "../../fhir/encounterHelpers";
import { homeInpatientGroups, type HomeInpatientGroup } from "../../fhir/homeSections";
import { displayName, patientNumberOf } from "../../fhir/patientHelpers";
import { useRowPictograms } from "../../hooks/useRowPictograms";
import { KARTE_TAB_PARAM } from "../../karteUrl";
import { useReturnLinkState } from "../../returnTo";
import { ErrorBanner } from "../ErrorBanner";
import { RowPictograms } from "../PatientListRowParts";
import { PatientKana } from "../PatientRowCells";
import { HomeCardFrame, HomeCardLoading, HomeCardTruncated, type HomeCardProps } from "./shared";

/**
 * 担当入院患者。入院患者一覧と同じ hook で在院中を読み、主治医か担当看護師で自分の担当に絞って
 * 病棟ごとにまとめる。看護師はその日の業務分担で受け持つ患者も担当に数える。
 */
export function InpatientCard({ card, date, practitionerId }: HomeCardProps<"inpatient">) {
  const by = card.settings.by;
  const inpatients = useInpatientEncounters(date);
  const bedWards = useBedWardIndex();
  const assignments = useMyNursingAssignments(by === "nurse" ? practitionerId : null, date);
  const assignedPatientIds = useMemo(
    () => new Set((assignments.data ?? []).map((a) => a.patient_id)),
    [assignments.data],
  );
  const groups = useMemo<HomeInpatientGroup[]>(
    () =>
      inpatients.data && practitionerId
        ? homeInpatientGroups(
            inpatients.data.byBed.values(),
            inpatients.data.patientsById,
            bedWards.bedWards,
            by,
            practitionerId,
            assignedPatientIds,
          )
        : [],
    [inpatients.data, bedWards.bedWards, by, practitionerId, assignedPatientIds],
  );
  const patientIds = useMemo(
    () => groups.flatMap((group) => group.rows.flatMap((row) => (row.patientId ? [row.patientId] : []))),
    [groups],
  );
  const pictograms = useRowPictograms(patientIds);
  const linkState = useReturnLinkState();

  // 未指示受けの件数は病棟単位でしか引けないので、担当患者が最も多い病棟のぶんだけ出す。
  const mainWardId =
    by === "nurse"
      ? [...groups]
          .filter((group) => group.wardId)
          .sort((a, b) => b.rows.length - a.rows.length)[0]?.wardId ?? undefined
      : undefined;
  const pending = useNursingPendingCounts(date, mainWardId);
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const isPending = inpatients.isPending || bedWards.isPending;

  return (
    <HomeCardFrame
      title={by === "attending" ? "担当入院患者(主治医)" : "担当入院患者(担当看護師・受け持ち)"}
      link={{ to: "/inpatients", label: "入院患者一覧" }}
    >
      <ErrorBanner error={inpatients.error ?? bedWards.error ?? assignments.error ?? pending.error} />
      {isPending ? (
        <HomeCardLoading />
      ) : (
        <>
          <p className="home__counts">
            <span className="home__count home__count--big">
              在院 <strong>{total}</strong>
            </span>
          </p>
          {inpatients.data?.truncated && (
            <HomeCardTruncated>入院が多いため、一部のみ表示しています。</HomeCardTruncated>
          )}
          {groups.length === 0 && (
            <p className="home__empty">
              {by === "attending" ? "主治医として登録された入院患者はいません。" : "担当看護師・受け持ちの入院患者はいません。"}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.wardId ?? "unknown"}>
              <p className="home__ward">
                {group.wardId ? (
                  <Link to={`/inpatients?ward=${group.wardId}&date=${date}`}>{group.wardName}</Link>
                ) : (
                  group.wardName
                )}
                <span className="home__ward-count">{group.rows.length} 名</span>
                {by === "nurse" && group.wardId && (
                  <Link
                    className="home__ward-link"
                    to={`/nursing-worksheet?ward=${group.wardId}&date=${date}&nurse=mine`}
                  >
                    ワークシート
                  </Link>
                )}
              </p>
              <div className="home__table-wrap">
                <table className="home__table">
                  <thead>
                    <tr>
                      <th>病室</th>
                      <th>患者番号</th>
                      <th>患者氏名</th>
                      <th>診療科</th>
                      <th>{by === "attending" ? "担当看護師" : "主治医"}</th>
                      <th>入院日</th>
                      {by === "nurse" && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => {
                      const pendingCount = row.patientId
                        ? (pending.countByPatientId.get(row.patientId) ?? 0)
                        : 0;
                      return (
                        <tr key={row.encounter.id}>
                          <td className="home__cell-compact">{row.roomName}</td>
                          <td className="home__cell-compact">
                            {row.patient ? patientNumberOf(row.patient) : ""}
                          </td>
                          <td>
                            {row.patient && row.patientId ? (
                              <Link
                                className="home__row-link"
                                to={`/patients/${row.patientId}/karte`}
                                state={linkState}
                              >
                                {displayName(row.patient)}
                              </Link>
                            ) : (
                              "-"
                            )}
                            <PatientKana patient={row.patient} />
                            {row.patientId && <RowPictograms patientId={row.patientId} {...pictograms} />}
                          </td>
                          <td className="home__cell-compact">{encounterDepartmentName(row.encounter)}</td>
                          <td className="home__cell-compact">
                            {by === "attending"
                              ? encounterNurseNames(row.encounter).join("、") || "-"
                              : encounterAttendingName(row.encounter)}
                          </td>
                          <td className="home__cell-compact">{encounterAdmissionDate(row.encounter)}</td>
                          {by === "nurse" && (
                            <td className="home__cell-compact">
                              {pendingCount > 0 && row.patientId && (
                                <Link
                                  className="inpatient__order-tag"
                                  to={`/patients/${row.patientId}/karte?${KARTE_TAB_PARAM}=nursing`}
                                  state={linkState}
                                >
                                  指示受け {pendingCount}
                                </Link>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </HomeCardFrame>
  );
}
