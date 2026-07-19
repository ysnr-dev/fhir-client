import { Link } from "react-router-dom";
import { summarizeServiceRequest } from "../fhir/prescriptionHelpers";

interface PrescriptionTableProps {
  prescriptions: fhir4.ServiceRequest[];
  patientId: string;
}

export function PrescriptionTable({ prescriptions, patientId }: PrescriptionTableProps) {
  if (prescriptions.length === 0) {
    return <p className="patient-table__empty">登録されている処方がありません。</p>;
  }

  return (
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
                <Link to={`/patients/${patientId}/prescriptions/${summary.id}`}>表示</Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
