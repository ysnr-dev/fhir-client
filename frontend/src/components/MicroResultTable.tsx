import { useDeleteMicroResult, type MicroResultSearchResources } from "../api/queries";
import { summarizeMicroResult } from "../fhir/microResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

interface MicroResultTableProps {
  resources: MicroResultSearchResources;
  /** 表示・編集はページ遷移せずカルテ画面の左ペイン内で行う。 */
  onView: (reportId: string) => void;
  onEdit: (reportId: string) => void;
}

export function MicroResultTable({ resources, onView, onEdit }: MicroResultTableProps) {
  const deleteMicroResult = useDeleteMicroResult();

  function handleDelete(reportId: string | undefined) {
    if (!reportId) return;
    if (!window.confirm("この細菌検査結果を削除します。よろしいですか?")) return;
    deleteMicroResult.mutate(reportId);
  }

  if (resources.reports.length === 0) {
    return <p className="patient-table__empty">登録されている細菌検査結果がありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteMicroResult.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>検体採取日</th>
            <th>報告</th>
            <th>材料</th>
            <th>培養</th>
            <th>分離菌</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {resources.reports.map((report) => {
            const summary = summarizeMicroResult(report, resources.observations);
            return (
              <tr key={summary.id}>
                <td>{summary.date}</td>
                <td>
                  {summary.preliminary ? (
                    <span className="micro-result__badge">中間</span>
                  ) : (
                    "最終"
                  )}
                </td>
                <td>{summary.specimenName || "-"}</td>
                <td>{summary.cultureDisplay || "-"}</td>
                <td className="micro-result__organisms">
                  {summary.isolateNames.length ? summary.isolateNames.join(", ") : "-"}
                </td>
                <td className="patient-table__actions">
                  <button type="button" onClick={() => onView(summary.id)}>
                    表示
                  </button>
                  <RowMenu label={`${summary.date} の細菌検査結果の操作`}>
                    <button
                      type="button"
                      className="row-menu__item"
                      onClick={() => onEdit(summary.id)}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleDelete(summary.id)}
                      disabled={deleteMicroResult.isPending}
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
