import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { useQuestionnaire, useUpdateQuestionnaire } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { QuestionnaireEditor } from "../components/QuestionnaireEditor";
import {
  buildQuestionnaire,
  collectPendingImageEntries,
  parseQuestionnaireForm,
  type QuestionnaireFormValues,
} from "../fhir/questionnaireHelpers";

export function QuestionnaireEditPage() {
  const { questionnaireId } = useParams<{ questionnaireId: string }>();
  const navigate = useNavigate();
  const { data: result, isLoading, error: loadError } = useQuestionnaire(questionnaireId);
  const updateQuestionnaire = useUpdateQuestionnaire();
  const [conflict, setConflict] = useState(false);

  const questionnaire = result?.data;

  function handleSubmit(values: QuestionnaireFormValues) {
    if (!questionnaireId || !result?.etag) return;
    setConflict(false);
    // 画像と本体を 1 つの transaction Bundle で更新するので、412 で弾かれた
    // ときは画像も保存されない(孤児が残らず、そのまま再送できる)。
    const { items, entries } = collectPendingImageEntries(values.items);
    updateQuestionnaire.mutate(
      {
        questionnaire: buildQuestionnaire({ ...values, items }, questionnaireId),
        etag: result.etag,
        imageEntries: entries,
      },
      {
        onSuccess: () => navigate("/questionnaires"),
        onError: (err) => {
          if (err instanceof FhirError && err.status === 412) {
            setConflict(true);
          }
        },
      },
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>テンプレート編集</h1>
        <Link to="/questionnaires" className="button">
          ← テンプレート一覧に戻る
        </Link>
      </div>

      <ErrorBanner error={loadError} />

      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            このテンプレートは他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        questionnaire && (
          <QuestionnaireEditor
            initialValues={parseQuestionnaireForm(questionnaire)}
            onSubmit={handleSubmit}
            submitting={updateQuestionnaire.isPending}
            submitError={conflict ? undefined : updateQuestionnaire.error}
            submitLabel="更新"
          />
        )
      )}
    </div>
  );
}
