import { useDeleteLabResult } from "../api/queries";
import { summarizeDiagnosticReport } from "../fhir/labResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

interface LabResultTableProps {
  reports: fhir4.DiagnosticReport[];
  /** 表示・編集はページ遷移せずカルテ画面の左ペイン内で行う。 */
  onView: (reportId: string) => void;
  onEdit: (reportId: string) => void;
}

export function LabResultTable({ reports, onView, onEdit }: LabResultTableProps) {
  const deleteLabResult = useDeleteLabResult();

  function handleDelete(reportId: string | undefined) {
    if (!reportId) return;
    if (!window.confirm("この検査結果を削除します。よろしいですか?")) return;
    deleteLabResult.mutate(reportId);
  }

  if (reports.length === 0) {
    return <p className="patient-table__empty">登録されている検査結果がありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteLabResult.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>検体採取日</th>
            <th>入外区分</th>
            <th>検査項目数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => {
            const summary = summarizeDiagnosticReport(report);
            return (
              <tr key={summary.id}>
                <td>{summary.date}</td>
                <td>{summary.settingDisplay}</td>
                <td>{summary.itemCount}</td>
                <td className="patient-table__actions">
                  <button type="button" onClick={() => onView(summary.id)}>
                    表示
                  </button>
                  <RowMenu label={`${summary.date} の検査結果の操作`}>
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
                      disabled={deleteLabResult.isPending}
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
