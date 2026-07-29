import { Link } from "react-router-dom";
import { useDeleteQuestionnaireResponse } from "../api/queries";
import { summarizeQuestionnaireResponse } from "../fhir/questionnaireResponseHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

interface QuestionnaireResponseTableProps {
  responses: fhir4.QuestionnaireResponse[];
  patientId: string;
  // canonical("<url>|<version>")→テンプレートタイトル。解決できない場合は canonical を表示する。
  titleByCanonical: Map<string, string>;
}

export function QuestionnaireResponseTable({
  responses,
  patientId,
  titleByCanonical,
}: QuestionnaireResponseTableProps) {
  const deleteResponse = useDeleteQuestionnaireResponse();

  function handleDelete(id: string, title: string) {
    if (!window.confirm(`テンプレート「${title}」の登録内容を削除します。よろしいですか?`)) return;
    deleteResponse.mutate(id);
  }

  if (responses.length === 0) {
    return <p className="patient-table__empty">登録されているテンプレートがありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteResponse.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>テンプレート</th>
            <th>ステータス</th>
            <th>記入日時</th>
            <th>記入者</th>
            <th>更新日時</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {responses.map((response) => {
            const summary = summarizeQuestionnaireResponse(response);
            const title = titleByCanonical.get(summary.questionnaire) ?? summary.questionnaire;
            const base = `/patients/${patientId}/questionnaire-responses/${summary.id}`;
            return (
              <tr key={summary.id}>
                <td>{title || "-"}</td>
                <td>{summary.statusLabel || "-"}</td>
                <td>{summary.authored || "-"}</td>
                <td>{summary.authorName || "-"}</td>
                <td>{summary.lastUpdated || "-"}</td>
                <td className="patient-table__actions">
                  <RowMenu label={`${title} の操作`}>
                    <Link className="row-menu__item" to={base}>
                      表示
                    </Link>
                    <Link className="row-menu__item" to={`${base}/edit`}>
                      編集
                    </Link>
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleDelete(summary.id, title)}
                      disabled={deleteResponse.isPending}
                    >
                      削除
                    </button>
                  </RowMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
