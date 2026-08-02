import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PatientHeader } from "../components/PatientHeader";
import { PrescriptionCreatePanel } from "../components/PrescriptionPanels";

export function PrescriptionCreatePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // ?from=<ServiceRequest id> が付いていれば、その処方を DO(投与量などの値も流用)する。
  const sourceSrId = searchParams.get("from") ?? undefined;

  if (!patientId) return null;

  return (
    <div className="page">
      <div className="page__header">
        <h1>{sourceSrId ? "処方登録(DO)" : "処方登録"}</h1>
        <Link to={`/patients/${patientId}/prescriptions`} className="button">
          ← 処方一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <PrescriptionCreatePanel
        patientId={patientId}
        sourceSrId={sourceSrId}
        onSaved={() => navigate(`/patients/${patientId}/prescriptions`)}
      />
    </div>
  );
}
