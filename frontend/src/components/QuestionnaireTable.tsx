import { Link } from "react-router-dom";
import { useDeleteQuestionnaire } from "../api/queries";
import { summarizeQuestionnaire } from "../fhir/questionnaireHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

interface QuestionnaireTableProps {
  questionnaires: fhir4.Questionnaire[];
}

export function QuestionnaireTable({ questionnaires }: QuestionnaireTableProps) {
  const deleteQuestionnaire = useDeleteQuestionnaire();

  function handleDelete(questionnaireId: string, title: string) {
    if (!window.confirm(`テンプレート「${title}」を削除します。よろしいですか?`)) return;
    deleteQuestionnaire.mutate(questionnaireId);
  }

  if (questionnaires.length === 0) {
    return <p className="patient-table__empty">登録されているテンプレートがありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteQuestionnaire.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>タイトル</th>
            <th>名前</th>
            <th>バージョン</th>
            <th>ステータス</th>
            <th>更新日時</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {questionnaires.map((questionnaire) => {
            const summary = summarizeQuestionnaire(questionnaire);
            return (
              <tr key={summary.id}>
                <td>{summary.title || "-"}</td>
                <td>{summary.name || "-"}</td>
                <td>{summary.version || "-"}</td>
                <td>{summary.statusLabel || "-"}</td>
                <td>{summary.lastUpdated || "-"}</td>
                <td className="patient-table__actions">
                  <RowMenu label={`${summary.title} の操作`}>
                    <Link className="row-menu__item" to={`/questionnaires/${summary.id}/preview`}>
                      表示
                    </Link>
                    <Link className="row-menu__item" to={`/questionnaires/${summary.id}/edit`}>
                      編集
                    </Link>
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleDelete(summary.id, summary.title)}
                      disabled={deleteQuestionnaire.isPending}
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
