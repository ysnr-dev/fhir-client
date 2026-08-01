import { Link, useNavigate, useParams } from "react-router-dom";
import { PatientHeader } from "../components/PatientHeader";
import { PrescriptionEditPanel } from "../components/PrescriptionPanels";

export function PrescriptionEditPage() {
  const { patientId, srId } = useParams<{ patientId: string; srId: string }>();
  const navigate = useNavigate();

  if (!patientId || !srId) return null;

  return (
    <div className="page">
      <div className="page__header">
        <h1>処方編集</h1>
        <Link to={`/patients/${patientId}/prescriptions/${srId}`} className="button">
          ← 処方詳細に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <PrescriptionEditPanel
        patientId={patientId}
        srId={srId}
        onSaved={() => navigate(`/patients/${patientId}/prescriptions/${srId}`)}
      />
    </div>
  );
}
