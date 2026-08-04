import { summarizeQuestionnaireResponse } from "../fhir/questionnaireResponseHelpers";
import { QuestionnaireResponseForm } from "./QuestionnaireResponseForm";

// テンプレート回答の内容表示。テンプレート表示ページとカルテ画面の詳細モーダルの
// 双方から使う。元テンプレートのフォームを読み取り専用で描くので、シェーマ画像への
// 描き込みもそのまま見られる(平文表示では画像を再現できない)。

interface QuestionnaireResponseDetailPanelProps {
  response: fhir4.QuestionnaireResponse;
  /** 回答の元テンプレート。見つからない場合は内容を描けないので案内を出す。 */
  questionnaire: fhir4.Questionnaire | undefined;
}

export function QuestionnaireResponseDetailPanel({
  response,
  questionnaire,
}: QuestionnaireResponseDetailPanelProps) {
  if (!questionnaire) {
    return (
      <p className="patient-table__empty">
        元テンプレート({response.questionnaire})が見つからないため、内容を表示できません。
      </p>
    );
  }

  const summary = summarizeQuestionnaireResponse(response);

  return (
    <QuestionnaireResponseForm questionnaire={questionnaire} initialResponse={response} readOnly>
      <fieldset className="qp-group">
        <legend>登録情報</legend>
        <dl className="qr-meta">
          <div className="qr-meta__item">
            <dt>ステータス</dt>
            <dd>{summary.statusLabel || "-"}</dd>
          </div>
          <div className="qr-meta__item">
            <dt>記入日時</dt>
            <dd>{summary.authored || "-"}</dd>
          </div>
          <div className="qr-meta__item">
            <dt>記入者</dt>
            <dd>{summary.authorName || "-"}</dd>
          </div>
        </dl>
      </fieldset>
    </QuestionnaireResponseForm>
  );
}
