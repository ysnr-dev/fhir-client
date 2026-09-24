import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLabResultImportMutations, useLabResultImports } from "../api/masterQueries";
import type { LabResultImport } from "../api/masterClient";
import { ErrorBanner } from "../components/ErrorBanner";
import { labInstantLabel } from "../fhir/labResultHelpers";

// 検査結果取込(部門業務 > 臨床検査部門)。検査室・分析装置・外注ラボから受け取った
// ファイルを読み込み、手入力と同じ形で上流に登録する。対応形式は JAHIS 臨床検査
// データ交換規約(HL7 v2.5)の ORU^R01 / OUL^R22。

// 文字コードは自動で判定する(BOM → ESC シーケンス → MSH-18 → UTF-8 妥当性 → CP932)。
// 判定が外れるファイルのために手で指定もできる。
const ENCODINGS = [
  { value: "auto", label: "自動判定" },
  { value: "utf-8", label: "UTF-8" },
  { value: "shift_jis", label: "Shift_JIS" },
  { value: "iso-2022-jp", label: "ISO-2022-JP" },
];

export function LabResultImportPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState("auto");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imports = useLabResultImports(page);

  // 詳細画面と同じ幅にする(一覧から詳細へ移ったときに紙面が動かないように)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);
  const { importFile, remove } = useLabResultImportMutations();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    importFile.mutate(
      { file, encoding },
      {
        onSuccess: (created) => {
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
          navigate(`/lab-result-imports/${created.import.id}`);
        },
      },
    );
  }

  function handleDelete(batch: LabResultImport) {
    if (!window.confirm(`${batch.file_name ?? "取込"} を削除しますか?`)) return;
    remove.mutate(batch.id);
  }

  const items = imports.data?.items ?? [];
  const hasNext = (imports.data?.total ?? 0) > page * (imports.data?.per ?? 20);

  return (
    <div className="page">
      <div className="page__header">
        <h1>検査結果取込</h1>
      </div>

      <form className="master-import-form" onSubmit={handleSubmit}>
        <label>
          取込ファイル
          <input
            ref={fileInputRef}
            type="file"
            accept=".hl7,.txt,.dat,text/plain"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              importFile.reset();
            }}
          />
        </label>
        <label>
          文字コード
          <select value={encoding} onChange={(event) => setEncoding(event.target.value)}>
            {ENCODINGS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="master-import-form__actions">
          <button type="submit" disabled={!file || importFile.isPending}>
            {importFile.isPending ? "取込中..." : "取込実行"}
          </button>
        </div>
        <ErrorBanner error={importFile.error} />
      </form>

      <ErrorBanner error={imports.error ?? remove.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>取込日時</th>
            <th>取込元</th>
            <th>ファイル</th>
            <th>形式</th>
            <th>文字コード</th>
            <th>保留</th>
            <th>登録待ち</th>
            <th>登録済み</th>
            <th>対象外</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((batch) => (
            <tr key={batch.id}>
              <td>
                <Link to={`/lab-result-imports/${batch.id}`}>
                  {labInstantLabel(batch.created_at)}
                </Link>
              </td>
              <td>{batch.source ?? ""}</td>
              <td>{batch.file_name ?? ""}</td>
              <td>{batch.message_type ?? batch.format}</td>
              <td>{batch.encoding ?? ""}</td>
              <td>{batch.status_counts.pending ?? 0}</td>
              <td>{batch.status_counts.ready ?? 0}</td>
              <td>{batch.status_counts.registered ?? 0}</td>
              <td>{batch.status_counts.skipped ?? 0}</td>
              <td>
                <button type="button" onClick={() => handleDelete(batch)}>
                  削除
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && !imports.isLoading && (
            <tr>
              <td colSpan={10} className="master-search__empty">
                取込はまだありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="master-search__pager">
        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          前へ
        </button>
        <span>{page}</span>
        <button type="button" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
          次へ
        </button>
      </div>
    </div>
  );
}
