import { Link } from "react-router-dom";
import { useDeletePatient } from "../api/queries";
import { displayKana, displayName } from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { HoverMenu } from "./HoverMenu";
import { RowMenu } from "./RowMenu";

export function PatientTable({ patients }: { patients: fhir4.Patient[] }) {
  const deletePatient = useDeletePatient();

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
      <table className="patient-table">
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
              <td>{displayName(patient)}</td>
              <td>{displayKana(patient)}</td>
              <td>{patient.gender ?? "-"}</td>
              <td>{patient.birthDate ?? "-"}</td>
              <td>{patient.active === false ? "無効" : "有効"}</td>
              <td className="patient-table__actions">
                <Link className="button" to={`/patients/${patient.id}/karte`}>
                  カルテ
                </Link>
                {/* 「診療情報」メニューはカルテ画面へ移行するまでの暫定。 */}
                <HoverMenu label="診療情報">
                  <Link className="row-menu__item" to={`/patients/${patient.id}/clinical-notes`}>
                    診療記録
                  </Link>
                  <Link className="row-menu__item" to={`/patients/${patient.id}/prescriptions`}>
                    処方
                  </Link>
                  <Link className="row-menu__item" to={`/patients/${patient.id}/conditions`}>
                    病名
                  </Link>
                  <Link className="row-menu__item" to={`/patients/${patient.id}/allergies`}>
                    アレルギー
                  </Link>
                  <Link className="row-menu__item" to={`/patients/${patient.id}/lab-results`}>
                    検査結果
                  </Link>
                  <Link
                    className="row-menu__item"
                    to={`/patients/${patient.id}/questionnaire-responses`}
                  >
                    テンプレート
                  </Link>
                </HoverMenu>
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
