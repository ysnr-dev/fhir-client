import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PatientFolderMember } from "../api/masterClient";
import { ageWithMonthsLabel, displayName, genderShortLabel } from "../fhir/patientHelpers";
import type { Pictograms } from "../hooks/useRowPictograms";
import { localDay } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";
import { RowPictograms } from "./PatientListRowParts";
import type { useRowDrawer } from "./PatientProfileDrawer";
import { PatientDeceasedMark, PatientKana } from "./PatientRowCells";

// 患者フォルダの患者の表。患者フォルダの画面(操作つき)とホームのカード(読むだけ)が共用する。

interface Props {
  members: PatientFolderMember[];
  patients: Map<string, fhir4.Patient> | undefined;
  patientsPending: boolean;
  pictograms: Pictograms;
  /** 下位フォルダを含めて見るときのフォルダ列。 */
  folderPathOf?: (folderId: number) => string;
  /** 行を押して患者のドロワーを開く(患者フォルダの画面)。 */
  rowProps?: ReturnType<typeof useRowDrawer>["rowProps"];
  /** 行末の操作(カルテの右)。 */
  actions?: (member: PatientFolderMember) => ReactNode;
  className?: string;
}

export function PatientFolderMemberTable({
  members,
  patients,
  patientsPending,
  pictograms,
  folderPathOf,
  rowProps,
  actions,
  className = "patient-table patient-list",
}: Props) {
  const returnLinkState = useReturnLinkState();
  return (
    <table className={className}>
      <thead>
        <tr>
          <th>患者番号</th>
          <th>氏名</th>
          <th>性別</th>
          <th>生年月日</th>
          {folderPathOf && <th>フォルダ</th>}
          <th>メモ</th>
          <th>登録日</th>
          <th>登録者</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {members.map((member) => {
          const patient = patients?.get(member.patient_id);
          const missing = !patient && !patientsPending;
          return (
            <tr key={member.id} {...rowProps?.(patient ? member.patient_id : undefined)}>
              <td>{patient?.identifier?.[0]?.value ?? "-"}</td>
              <td>
                {patient ? (
                  <span className="outpatient__name-cell">
                    <span className="outpatient__name">
                      {displayName(patient) || "-"}
                      <PatientKana patient={patient} />
                    </span>
                    <PatientDeceasedMark patient={patient} />
                    <RowPictograms patientId={member.patient_id} {...pictograms} />
                  </span>
                ) : missing ? (
                  <span className="patient-folder__missing">患者が見つかりません({member.patient_id})</span>
                ) : (
                  "…"
                )}
              </td>
              <td>{patient ? genderShortLabel(patient.gender) : "-"}</td>
              <td>
                {patient?.birthDate ?? "-"}
                {patient?.birthDate && ageWithMonthsLabel(patient.birthDate) && (
                  <span className="patient-cells__age">（{ageWithMonthsLabel(patient.birthDate)}）</span>
                )}
              </td>
              {folderPathOf && <td>{folderPathOf(member.patient_folder_id)}</td>}
              <td className="patient-folder__note">{member.note ?? ""}</td>
              <td>{localDay(member.created_at)}</td>
              <td>{member.added_by_name ?? ""}</td>
              <td className="patient-table__actions">
                {patient && (
                  <Link className="button" to={`/patients/${member.patient_id}/karte`} state={returnLinkState}>
                    カルテ
                  </Link>
                )}
                {actions?.(member)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
