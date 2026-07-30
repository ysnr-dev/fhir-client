import { Link, useNavigate } from "react-router-dom";
import { useCreateQuestionnaire } from "../api/queries";
import { QuestionnaireEditor } from "../components/QuestionnaireEditor";
import { buildQuestionnaire, type QuestionnaireFormValues } from "../fhir/questionnaireHelpers";

export function QuestionnaireCreatePage() {
  const navigate = useNavigate();
  const createQuestionnaire = useCreateQuestionnaire();

  function handleSubmit(values: QuestionnaireFormValues) {
    createQuestionnaire.mutate(buildQuestionnaire(values), {
      onSuccess: () => navigate("/questionnaires"),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>テンプレート作成</h1>
        <Link to="/questionnaires" className="button">
          ← テンプレート一覧に戻る
        </Link>
      </div>

      <QuestionnaireEditor
        onSubmit={handleSubmit}
        submitting={createQuestionnaire.isPending}
        submitError={createQuestionnaire.error}
      />
    </div>
  );
}
