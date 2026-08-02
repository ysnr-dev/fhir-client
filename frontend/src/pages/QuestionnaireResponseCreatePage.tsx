import { Link, useNavigate, useParams } from "react-router-dom";
import { PatientHeader } from "../components/PatientHeader";
import { QuestionnaireResponseCreatePanel } from "../components/QuestionnaireResponsePanels";

export function QuestionnaireResponseCreatePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();

  if (!patientId) return null;

  return (
    <div className="page">
      <div className="page__header">
        <h1>テンプレート登録</h1>
        <Link to={`/patients/${patientId}/questionnaire-responses`} className="button">
          ← テンプレート一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <QuestionnaireResponseCreatePanel
        patientId={patientId}
        onSaved={() => navigate(`/patients/${patientId}/questionnaire-responses`)}
      />
    </div>
  );
}
