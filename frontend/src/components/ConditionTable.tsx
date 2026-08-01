import { Link } from "react-router-dom";
import { useDeleteCondition } from "../api/queries";
import { summarizeCondition } from "../fhir/conditionHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

interface ConditionTableProps {
  conditions: fhir4.Condition[];
  patientId: string;
  /** 指定するとページ遷移せずこのコールバックで編集する(カルテ画面の左ペイン用)。 */
  onEdit?: (conditionId: string) => void;
}

export function ConditionTable({ conditions, patientId, onEdit }: ConditionTableProps) {
  const deleteCondition = useDeleteCondition();

  function handleDelete(conditionId: string | undefined, name: string) {
    if (!conditionId) return;
    if (!window.confirm(`病名「${name}」を削除します。よろしいですか?`)) return;
    deleteCondition.mutate(conditionId);
  }

  if (conditions.length === 0) {
    return <p className="patient-table__empty">登録されている病名がありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteCondition.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>病名</th>
            <th>開始日</th>
            <th>終了日</th>
            <th>転帰</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {conditions.map((condition) => {
            const summary = summarizeCondition(condition);
            return (
              <tr key={summary.id}>
                <td>{summary.name}</td>
                <td>{summary.startDate || "-"}</td>
                <td>{summary.endDate || "-"}</td>
                <td>{summary.outcomeDisplay || "-"}</td>
                <td className="patient-table__actions">
                  {!onEdit && (
                    <Link className="button" to={`/patients/${patientId}/conditions/${summary.id}`}>
                      表示
                    </Link>
                  )}
                  <RowMenu label={`${summary.name} の操作`}>
                    {onEdit ? (
                      <button
                        type="button"
                        className="row-menu__item"
                        onClick={() => onEdit(summary.id)}
                      >
                        編集
                      </button>
                    ) : (
                      <Link
                        className="row-menu__item"
                        to={`/patients/${patientId}/conditions/${summary.id}/edit`}
                      >
                        編集
                      </Link>
                    )}
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleDelete(summary.id, summary.name)}
                      disabled={deleteCondition.isPending}
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
