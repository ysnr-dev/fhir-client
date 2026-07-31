import { Link } from "react-router-dom";
import { useDeleteAllergy } from "../api/queries";
import { summarizeAllergy } from "../fhir/allergyHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

interface AllergyTableProps {
  allergies: fhir4.AllergyIntolerance[];
  patientId: string;
}

export function AllergyTable({ allergies, patientId }: AllergyTableProps) {
  const deleteAllergy = useDeleteAllergy();

  function handleDelete(allergyId: string | undefined, name: string) {
    if (!allergyId) return;
    if (!window.confirm(`アレルギー「${name}」を削除します。よろしいですか?`)) return;
    deleteAllergy.mutate(allergyId);
  }

  if (allergies.length === 0) {
    return <p className="patient-table__empty">登録されているアレルギーがありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteAllergy.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>アレルゲン</th>
            <th>分類</th>
            <th>タイプ</th>
            <th>重篤化リスク</th>
            <th>臨床状態</th>
            <th>記録日</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {allergies.map((allergy) => {
            const summary = summarizeAllergy(allergy);
            return (
              <tr key={summary.id}>
                <td>{summary.name}</td>
                <td>{summary.categoryLabel || "-"}</td>
                <td>{summary.typeLabel || "-"}</td>
                <td>{summary.criticalityLabel || "-"}</td>
                <td>{summary.clinicalStatusLabel || "-"}</td>
                <td>{summary.recordedDate || "-"}</td>
                <td className="patient-table__actions">
                  <Link className="button" to={`/patients/${patientId}/allergies/${summary.id}`}>
                    表示
                  </Link>
                  <RowMenu label={`${summary.name} の操作`}>
                    <Link
                      className="row-menu__item"
                      to={`/patients/${patientId}/allergies/${summary.id}/edit`}
                    >
                      編集
                    </Link>
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleDelete(summary.id, summary.name)}
                      disabled={deleteAllergy.isPending}
                    >
                      削除
                    </button>
                  </RowMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
