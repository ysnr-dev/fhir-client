import { useEffect, useMemo, useState } from "react";
import { usePatientFileBlob } from "../api/queries";
import { previewKindOf, type PatientFile } from "../fhir/patientFileHelpers";
import { ErrorBanner } from "./ErrorBanner";

// 取り込んだファイルのプレビューとダウンロード。中身は Binary から blob で取り、
// object URL にして描く(dataURL にすると大きなファイルで文字列が肥大するため)。
// 表示できない形式はダウンロードだけにする。

export function KarteFilePreview({ file }: { file: PatientFile }) {
  const { data: blob, isLoading, error } = usePatientFileBlob(file.binaryId);
  const kind = previewKindOf(file.contentType);
  const [text, setText] = useState<string | null>(null);

  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  useEffect(() => {
    if (kind !== "text" || !blob) {
      setText(null);
      return;
    }
    let cancelled = false;
    void blob.text().then((value) => {
      if (!cancelled) setText(value);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, blob]);

  if (!file.binaryId) {
    return <p className="patient-table__empty">ファイルの本体が見つかりません。</p>;
  }

  return (
    <div className="karte-file-preview">
      <ErrorBanner error={error} />
      {isLoading || !url ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <p className="karte-file-preview__actions">
            <a href={url} download={file.title}>
              ダウンロード
            </a>
          </p>
          {kind === "image" && (
            <img className="karte-file-preview__image" src={url} alt={file.title} />
          )}
          {kind === "pdf" && (
            <object className="karte-file-preview__pdf" data={url} type="application/pdf">
              <p>このブラウザでは PDF を表示できません。ダウンロードして開いてください。</p>
            </object>
          )}
          {kind === "text" && <pre className="karte-file-preview__text">{text ?? ""}</pre>}
        </>
      )}
    </div>
  );
}
