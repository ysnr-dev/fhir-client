import { useDeletePatientFile, usePatientFileBlob } from "../api/queries";
import { contentTypeLabel, formatFileSize, type PatientFile } from "../fhir/patientFileHelpers";
import { useObjectUrl } from "../hooks/useObjectUrl";
import { ErrorBanner } from "./ErrorBanner";
import { FileTypeIcon } from "./FileTypeIcon";
import { RowMenu } from "./RowMenu";

// 取り込んだファイルのサムネイル表示。スキャンした書類は名前より見た目で探す方が
// 早いので、表と切り替えて使う。中身を読むのは画像だけで、それ以外は MIME ごとの
// アイコンを出す(PDF や Office の 1 ページ目を描くには別のレンダラが要る)。

export function PatientFileGrid({
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
      <ul className="karte-file-grid">
        {files.map((file) => (
          <li key={file.id} className="karte-file-card">
            <button
              type="button"
              className="karte-file-card__open"
              onClick={() => onView(file.id)}
              title={file.title}
            >
              <span className="karte-file-card__thumb">
                <FileThumbnail file={file} />
              </span>
              <span className="karte-file-card__title">{file.title}</span>
              <span className="karte-file-card__meta">
                {file.date || "日付なし"}
                {file.categoryName && ` / ${file.categoryName}`}
              </span>
              <span className="karte-file-card__meta">
                {contentTypeLabel(file.contentType)}
                {file.size === null ? "" : ` / ${formatFileSize(file.size)}`}
              </span>
            </button>
            <span className="karte-file-card__menu">
              <RowMenu label={`${file.title} の操作`}>
                <button type="button" className="row-menu__item" onClick={() => onEdit(file.id)}>
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
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function FileThumbnail({ file }: { file: PatientFile }) {
  const isImage = file.contentType.startsWith("image/");
  // 画像でないファイルは中身を読まない(1 ページ目を描く手段が無く、読んでも使い道がない)。
  const { data: blob, isLoading } = usePatientFileBlob(isImage ? file.binaryId : undefined);
  const url = useObjectUrl(blob);

  // 読み込み中も枠を空にせずアイコンを出す(入れ替わりで並びがちらつかないように)。
  if (!url) {
    return (
      <span className="karte-file-card__kind" title={contentTypeLabel(file.contentType)}>
        <FileTypeIcon contentType={file.contentType} />
        {isImage && isLoading && <span className="karte-file-card__loading">読み込み中</span>}
      </span>
    );
  }
  return <img className="karte-file-card__image" src={url} alt="" />;
}
