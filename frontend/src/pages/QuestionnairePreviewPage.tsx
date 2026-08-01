import { Link, useParams } from "react-router-dom";
import { useQuestionnaire } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { JsonBlock } from "../components/JsonBlock";
import { QuestionnaireResponseForm } from "../components/QuestionnaireResponseForm";
import { useLoginAutofillSource } from "../hooks/useLoginAutofillSource";

export function QuestionnairePreviewPage() {
  const { questionnaireId } = useParams<{ questionnaireId: string }>();
  const { data: result, isLoading, error } = useQuestionnaire(questionnaireId);
  // 拡張設定の自動入力もプレビューで確認できるようにする(登録画面と同じ材料)。
  const loginAutofill = useLoginAutofillSource();

  const questionnaire = result?.data;

  return (
    <div className="page">
      <div className="page__header">
        <h1>テンプレート表示</h1>
        <div>
          <Link to={`/questionnaires/${questionnaireId}/edit`} className="button">
            編集
          </Link>
          <Link to="/questionnaires" className="button">
            ← テンプレート一覧に戻る
          </Link>
        </div>
      </div>

      <div className="qp-notice" role="note">
        プレビュー表示です。入力した内容は保存されません。
      </div>

      <ErrorBanner error={error} />

      {isLoading || !loginAutofill.ready ? (
        <p>読み込み中...</p>
      ) : (
        questionnaire && (
          <>
            <QuestionnaireResponseForm
              questionnaire={questionnaire}
              loginAutofill={loginAutofill.source}
            />

            <details className="prescription-detail__raw">
              <summary>FHIR JSON を表示</summary>
              <JsonBlock value={questionnaire} />
            </details>
          </>
        )
      )}
    </div>
  );
}
