import { Link, useNavigate } from "react-router-dom";
import { useCreateQuestionnaire } from "../api/queries";
import { QuestionnaireEditor } from "../components/QuestionnaireEditor";
import {
  buildQuestionnaire,
  collectPendingImageEntries,
  type QuestionnaireFormValues,
} from "../fhir/questionnaireHelpers";

export function QuestionnaireCreatePage() {
  const navigate = useNavigate();
  const createQuestionnaire = useCreateQuestionnaire();

  function handleSubmit(values: QuestionnaireFormValues) {
    // シェーマ画像は本体と同じ transaction Bundle で保存する(部分失敗なし)。
    const { items, entries } = collectPendingImageEntries(values.items);
    createQuestionnaire.mutate(
      { questionnaire: buildQuestionnaire({ ...values, items }), imageEntries: entries },
      { onSuccess: () => navigate("/questionnaires") },
    );
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
