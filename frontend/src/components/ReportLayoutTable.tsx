import { formatDateTime } from "../lib/dates";
import type { ReportLayoutSummary } from "../api/adminClient";
import { fetchReportLayout } from "../api/adminClient";
import { useDeleteReportLayout } from "../api/adminQueries";
import { ErrorBanner } from "./ErrorBanner";

interface Props {
  layouts: ReportLayoutSummary[];
  onEdit: (layout: ReportLayoutSummary) => void;
}

export function ReportLayoutTable({ layouts, onEdit }: Props) {
  const deleteLayout = useDeleteReportLayout();

  function handleDelete(layout: ReportLayoutSummary) {
    if (
      !window.confirm(
        `${layout.name} を削除します。このテンプレートの PDF 出力はできなくなります。よろしいですか?`,
      )
    ) {
      return;
    }
    deleteLayout.mutate(layout.id);
  }

  // Basic Editor での再編集用に、保存済みの .tlf を取得してダウンロードさせる。
  async function handleDownload(layout: ReportLayoutSummary) {
    const detail = await fetchReportLayout(layout.id);
    const blob = new Blob([detail.tlf], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${layout.name}.tlf`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (layouts.length === 0) {
    return <p className="patient-table__empty">登録されている帳票レイアウトはありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteLayout.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>テンプレート(canonical)</th>
            <th>サイズ</th>
            <th>マッピング</th>
            <th>更新日時</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {layouts.map((layout) => (
            <tr key={layout.id}>
              <td>{layout.name}</td>
              <td>{layout.canonical}</td>
              <td>{(layout.tlf_bytesize / 1024).toFixed(1)} KB</td>
              <td>{layout.mapping_set ? "あり" : "-"}</td>
              <td>{formatDateTime(layout.updated_at)}</td>
              <td className="patient-table__actions">
                <button type="button" onClick={() => onEdit(layout)}>
                  編集
                </button>
                <button type="button" onClick={() => void handleDownload(layout)}>
                  ダウンロード
                </button>
                <button type="button" onClick={() => handleDelete(layout)}>
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
