import { Link, useParams } from "react-router-dom";
import { useQuestionnaireByCanonical, useQuestionnaireResponse } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { JsonBlock } from "../components/JsonBlock";
import { PatientHeader } from "../components/PatientHeader";
import { QuestionnaireResponseForm } from "../components/QuestionnaireResponseForm";
import { summarizeQuestionnaireResponse } from "../fhir/questionnaireResponseHelpers";

export function QuestionnaireResponseDetailPage() {
  const { patientId, qrId } = useParams<{ patientId: string; qrId: string }>();

  const { data: result, isLoading, error } = useQuestionnaireResponse(qrId);
  const response = result?.data;

  const {
    questionnaire,
    isLoading: questionnaireLoading,
    error: questionnaireError,
  } = useQuestionnaireByCanonical(response?.questionnaire);

  const summary = response ? summarizeQuestionnaireResponse(response) : undefined;

  return (
    <div className="page">
      <div className="page__header">
        <h1>テンプレート表示</h1>
        <div>
          <Link
            to={`/patients/${patientId}/questionnaire-responses/${qrId}/edit`}
            className="button"
          >
            編集
          </Link>
          <Link to={`/patients/${patientId}/questionnaire-responses`} className="button">
            ← テンプレート一覧に戻る
          </Link>
        </div>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={error} />
      <ErrorBanner error={questionnaireError} />

      {isLoading || questionnaireLoading ? (
        <p>読み込み中...</p>
      ) : response && !questionnaire ? (
        <p className="patient-table__empty">
          元テンプレート({response.questionnaire})が見つからないため、内容を表示できません。
        </p>
      ) : (
        response &&
        questionnaire && (
          <>
            <QuestionnaireResponseForm
              questionnaire={questionnaire}
              initialResponse={response}
              readOnly
            >
              <fieldset className="qp-group">
                <legend>登録情報</legend>
                <dl className="qr-meta">
                  <div className="qr-meta__item">
                    <dt>ステータス</dt>
                    <dd>{summary?.statusLabel || "-"}</dd>
                  </div>
                  <div className="qr-meta__item">
                    <dt>記入日時</dt>
                    <dd>{summary?.authored || "-"}</dd>
                  </div>
                  <div className="qr-meta__item">
                    <dt>記入者</dt>
                    <dd>{summary?.authorName || "-"}</dd>
                  </div>
                </dl>
              </fieldset>
            </QuestionnaireResponseForm>

            <details className="prescription-detail__raw">
              <summary>FHIR JSON を表示</summary>
              <JsonBlock value={response} />
            </details>
          </>
        )
      )}
    </div>
  );
}
