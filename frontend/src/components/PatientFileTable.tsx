import { useDeletePatientFile } from "../api/queries";
import { karteDayLabel } from "../fhir/karteTimeline";
import {
  contentTypeLabel,
  formatFileSize,
  groupPatientFilesByDate,
  type PatientFile,
} from "../fhir/patientFileHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

// 取り込んだファイルの一覧。表示・編集はページ遷移せずカルテ画面の左ペイン内で行う。
// 診療日ごとに見出しを挟むので、行には日付の列を持たない。

const COLUMN_COUNT = 5;

export function PatientFileTable({
  files,
  onView,
  onEdit,
}: {
  files: PatientFile[];
  onView: (fileId: string) => void;
  onEdit: (fileId: string) => void;
}) {
  const deleteFile = useDeletePatientFile();

  function handleDelete(file: PatientFile) {
    if (!window.confirm(`ファイル「${file.title}」を削除します。よろしいですか?`)) return;
    deleteFile.mutate(file.id);
  }

  if (files.length === 0) {
    return <p className="patient-table__empty">取り込んだファイルがありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteFile.error} />
      <table className="patient-table karte-file-table">
        <thead>
          <tr>
            <th>カテゴリ</th>
            <th>表示名</th>
            <th>種類</th>
            <th>サイズ</th>
            <th></th>
          </tr>
        </thead>
        {groupPatientFilesByDate(files).map((group) => (
          <tbody key={group.date || "undated"}>
            <tr className="karte-file-table__day">
              <th colSpan={COLUMN_COUNT} scope="colgroup">
                {karteDayLabel(group.date)}
              </th>
            </tr>
            {group.files.map((file) => (
              <tr key={file.id}>
                <td>{file.categoryName || "-"}</td>
                <td>{file.title}</td>
                <td>{contentTypeLabel(file.contentType)}</td>
                <td>{formatFileSize(file.size) || "-"}</td>
                <td className="patient-table__actions">
                  <button type="button" onClick={() => onView(file.id)}>
                    表示
                  </button>
                  <RowMenu label={`${file.title} の操作`}>
                    <button
                      type="button"
                      className="row-menu__item"
                      onClick={() => onEdit(file.id)}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleDelete(file)}
                      disabled={deleteFile.isPending}
                    >
                      削除
                    </button>
                  </RowMenu>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </>
  );
}
