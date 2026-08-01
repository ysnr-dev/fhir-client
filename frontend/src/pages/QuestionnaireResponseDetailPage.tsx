import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuestionnaireResponseWithQuestionnaire } from "../api/queries";
import { questionnaireResponsePdfUrl, useReportLayoutStatus } from "../api/reportsClient";
import { ErrorBanner } from "../components/ErrorBanner";
import { JsonBlock } from "../components/JsonBlock";
import { PatientHeader } from "../components/PatientHeader";
import { PlainTextModal } from "../components/PlainTextModal";
import { QuestionnaireResponseForm } from "../components/QuestionnaireResponseForm";
import {
  questionnaireResponsePlainText,
  summarizeQuestionnaireResponse,
} from "../fhir/questionnaireResponseHelpers";

export function QuestionnaireResponseDetailPage() {
  const { patientId, qrId } = useParams<{ patientId: string; qrId: string }>();
  const [plainTextOpen, setPlainTextOpen] = useState(false);

  // 回答と元テンプレートを _include で 1 リクエスト取得する。
  const { response, questionnaire, isLoading, error } =
    useQuestionnaireResponseWithQuestionnaire(qrId);

  const summary = response ? summarizeQuestionnaireResponse(response) : undefined;

  // 帳票レイアウトが登録されているテンプレートだけ PDF 出力できる。
  const { data: layoutStatus } = useReportLayoutStatus(response?.questionnaire);
  const pdfReady = Boolean(layoutStatus?.registered && qrId);

  return (
    <div className="page">
      <div className="page__header">
        <h1>テンプレート表示</h1>
        <div>
          <button
            type="button"
            className="button"
            disabled={!response || !questionnaire}
            onClick={() => setPlainTextOpen(true)}
          >
            平文
          </button>
          {pdfReady ? (
            <a
              className="button"
              href={questionnaireResponsePdfUrl(qrId!)}
              target="_blank"
              rel="noopener"
            >
              PDF
            </a>
          ) : (
            <button
              type="button"
              className="button"
              disabled
              title="このテンプレートの帳票レイアウトが未登録です"
            >
              PDF
            </button>
          )}
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

      {isLoading ? (
        <p>読み込み中...</p>
      ) : !response && !error ? (
        <p className="patient-table__empty">この回答は見つかりません(削除された可能性があります)。</p>
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

            {plainTextOpen && (
              <PlainTextModal
                title="平文表示"
                text={questionnaireResponsePlainText(questionnaire, response)}
                onClose={() => setPlainTextOpen(false)}
              />
            )}
          </>
        )
      )}
    </div>
  );
}
