import { Link, useNavigate, useParams } from "react-router-dom";
import { ClinicalNoteCreatePanel } from "../components/ClinicalNotePanels";
import { PatientHeader } from "../components/PatientHeader";

export function ClinicalNoteCreatePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();

  if (!patientId) return null;

  return (
    <div className="page">
      <div className="page__header">
        <h1>診療記録登録</h1>
        <Link to={`/patients/${patientId}/clinical-notes`} className="button">
          ← 診療記録一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ClinicalNoteCreatePanel
        patientId={patientId}
        onSaved={() => navigate(`/patients/${patientId}/clinical-notes`)}
      />
    </div>
  );
}
