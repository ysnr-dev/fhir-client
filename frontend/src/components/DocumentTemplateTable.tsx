import { useState } from "react";
import { fetchDocumentTemplateFile, type DocumentTemplateSummary } from "../api/adminClient";
import { useDeleteDocumentTemplate, useUpdateDocumentTemplate } from "../api/adminQueries";
import { contentTypeLabel, formatFileSize } from "../fhir/patientFileHelpers";
import { formatDateTime } from "../lib/dates";
import { downloadBlob } from "../lib/download";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

interface Props {
  templates: DocumentTemplateSummary[];
  onEdit: (template: DocumentTemplateSummary) => void;
}

export function DocumentTemplateTable({ templates, onEdit }: Props) {
  const deleteTemplate = useDeleteDocumentTemplate();
  const updateTemplate = useUpdateDocumentTemplate();
  const [downloadError, setDownloadError] = useState<unknown>(null);

  function handleDelete(template: DocumentTemplateSummary) {
    if (
      !window.confirm(
        `${template.name} を削除します。作成済みの文書は残ります。よろしいですか?`,
      )
    ) {
      return;
    }
    deleteTemplate.mutate(template.id);
  }

  // Word / Excel で編集し直すために、登録済みの本体をダウンロードさせる。
  async function handleDownload(template: DocumentTemplateSummary) {
    setDownloadError(null);
    try {
      const bytes = await fetchDocumentTemplateFile(template.id);
      downloadBlob(
        new Blob([bytes as BlobPart], { type: template.content_type }),
        template.file_name,
      );
    } catch (err) {
      setDownloadError(err);
    }
  }

  if (templates.length === 0) {
    return <p className="patient-table__empty">登録されている文書テンプレートはありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteTemplate.error} />
      <ErrorBanner error={updateTemplate.error} />
      <ErrorBanner error={downloadError} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>カテゴリ</th>
            <th>ファイル</th>
            <th>種類</th>
            <th>サイズ</th>
            <th>状態</th>
            <th>更新日時</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr key={template.id}>
              <td>{template.name}</td>
              <td>{template.file_category_name ?? "-"}</td>
              <td>{template.file_name}</td>
              <td>{contentTypeLabel(template.content_type)}</td>
              <td>{formatFileSize(template.byte_size)}</td>
              <td>{template.active ? "有効" : "無効"}</td>
              <td>{formatDateTime(template.updated_at)}</td>
              <td className="patient-table__actions">
                <button type="button" onClick={() => void handleDownload(template)}>
                  ダウンロード
                </button>
                <RowMenu label={`${template.name} の操作`}>
                  <button type="button" className="row-menu__item" onClick={() => onEdit(template)}>
                    編集
                  </button>
                  <button
                    type="button"
                    className="row-menu__item"
                    disabled={updateTemplate.isPending}
                    onClick={() =>
                      updateTemplate.mutate({
                        id: template.id,
                        payload: { active: !template.active },
                      })
                    }
                  >
                    {template.active ? "無効にする" : "有効にする"}
                  </button>
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    disabled={deleteTemplate.isPending}
                    onClick={() => handleDelete(template)}
                  >
                    削除
                  </button>
                </RowMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
