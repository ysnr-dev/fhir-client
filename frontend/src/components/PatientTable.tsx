import { Link } from "react-router-dom";
import { useDeletePatient } from "../api/queries";
import {
  ageWithMonthsLabel,
  displayKana,
  displayName,
  genderShortLabel,
} from "../fhir/patientHelpers";
import { PatientDeceasedMark } from "./PatientRowCells";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";
import { useReturnLinkState } from "../returnTo";

export function PatientTable({ patients }: { patients: fhir4.Patient[] }) {
  const deletePatient = useDeletePatient();
  // カルテの「戻る」でこの一覧(検索条件つき)に戻れるように遷移元を渡す。
  const returnLinkState = useReturnLinkState();

  function handleDelete(patient: fhir4.Patient) {
    if (!patient.id) return;
    const label = displayName(patient) || patient.id;
    if (!window.confirm(`${label} を削除します。よろしいですか?`)) return;
    deletePatient.mutate(patient.id);
  }

  if (patients.length === 0) {
    return <p className="patient-table__empty">該当する患者が見つかりませんでした。</p>;
  }

  return (
    <>
      <ErrorBanner error={deletePatient.error} />
      <table className="patient-table patient-list">
        <thead>
          <tr>
            <th>患者番号</th>
            <th>氏名</th>
            <th>カナ</th>
            <th>性別</th>
            <th>生年月日</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {patients.map((patient) => (
            <tr key={patient.id}>
              <td>{patient.identifier?.[0]?.value ?? "-"}</td>
              <td>
                {displayName(patient)}
                <PatientDeceasedMark patient={patient} />
              </td>
              <td>{displayKana(patient)}</td>
              <td>{genderShortLabel(patient.gender)}</td>
              <td>
                {patient.birthDate ?? "-"}
                {patient.birthDate && ageWithMonthsLabel(patient.birthDate) && (
                  <span className="patient-cells__age">（{ageWithMonthsLabel(patient.birthDate)}）</span>
                )}
              </td>
              <td>{patient.active === false ? "無効" : "有効"}</td>
              <td className="patient-table__actions">
                <Link className="button" to={`/patients/${patient.id}/karte`} state={returnLinkState}>
                  カルテ
                </Link>
                <RowMenu label={`${displayName(patient) || patient.id} の操作`}>
                  <Link className="row-menu__item" to={`/patients/${patient.id}/edit`}>
                    患者編集
                  </Link>
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    onClick={() => handleDelete(patient)}
                    disabled={deletePatient.isPending}
                  >
                    患者削除
                  </button>
                </RowMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
