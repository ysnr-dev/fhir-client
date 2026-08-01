import { Link, useNavigate, useParams } from "react-router-dom";
import { PatientHeader } from "../components/PatientHeader";
import { QuestionnaireResponseEditPanel } from "../components/QuestionnaireResponsePanels";

export function QuestionnaireResponseEditPage() {
  const { patientId, qrId } = useParams<{ patientId: string; qrId: string }>();
  const navigate = useNavigate();

  if (!patientId || !qrId) return null;

  return (
    <div className="page">
      <div className="page__header">
        <h1>テンプレート編集</h1>
        <Link to={`/patients/${patientId}/questionnaire-responses`} className="button">
          ← テンプレート一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <QuestionnaireResponseEditPanel
        patientId={patientId}
        qrId={qrId}
        onSaved={() => navigate(`/patients/${patientId}/questionnaire-responses`)}
      />
    </div>
  );
}
