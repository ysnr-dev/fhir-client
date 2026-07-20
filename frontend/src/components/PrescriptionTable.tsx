import { Link } from "react-router-dom";
import { useDeletePrescription } from "../api/queries";
import { summarizeServiceRequest } from "../fhir/prescriptionHelpers";
import { ErrorBanner } from "./ErrorBanner";

interface PrescriptionTableProps {
  prescriptions: fhir4.ServiceRequest[];
  patientId: string;
}

export function PrescriptionTable({ prescriptions, patientId }: PrescriptionTableProps) {
  const deletePrescription = useDeletePrescription();

  function handleDelete(srId: string | undefined) {
    if (!srId) return;
    if (!window.confirm("この処方を削除します。よろしいですか?")) return;
    deletePrescription.mutate(srId);
  }

  if (prescriptions.length === 0) {
    return <p className="patient-table__empty">登録されている処方がありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deletePrescription.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>処方日</th>
            <th>入外区分</th>
            <th>処方区分</th>
            <th>薬剤数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {prescriptions.map((sr) => {
            const summary = summarizeServiceRequest(sr);
            return (
              <tr key={summary.id}>
                <td>{summary.date}</td>
                <td>{summary.settingDisplay}</td>
                <td>{summary.categoryDisplay}</td>
                <td>{summary.medicineCount}</td>
                <td className="patient-table__actions">
                  <Link className="button" to={`/patients/${patientId}/prescriptions/${summary.id}`}>
                    表示
                  </Link>
                  <Link className="button" to={`/patients/${patientId}/prescriptions/${summary.id}/edit`}>
                    編集
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(summary.id)}
                    disabled={deletePrescription.isPending}
                  >
                    削除
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
