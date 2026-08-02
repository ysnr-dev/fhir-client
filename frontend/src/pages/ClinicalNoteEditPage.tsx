import { Link, useNavigate, useParams } from "react-router-dom";
import { ClinicalNoteEditPanel } from "../components/ClinicalNotePanels";
import { PatientHeader } from "../components/PatientHeader";

export function ClinicalNoteEditPage() {
  const { patientId, noteId } = useParams<{ patientId: string; noteId: string }>();
  const navigate = useNavigate();

  if (!patientId || !noteId) return null;

  return (
    <div className="page">
      <div className="page__header">
        <h1>診療記録編集</h1>
        <Link to={`/patients/${patientId}/clinical-notes`} className="button">
          ← 診療記録一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ClinicalNoteEditPanel
        patientId={patientId}
        noteId={noteId}
        onSaved={() => navigate(`/patients/${patientId}/clinical-notes`)}
      />
    </div>
  );
}
