import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useDpcClassifications, useDpcEditions } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { formatDateTime } from "../lib/dates";

// DPC 電子点数表の閲覧。取り込んだ版と、分類(上 6 桁)を選んだときの 14 桁・入院期間・点数。
// 取込はマスタ取込の画面で行い、ここでは読むだけ。

export function DpcTablesPage() {
  const editions = useDpcEditions();
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [mdc6, setMdc6] = useState("");
  const list = useDpcClassifications({ q: query, mdc6 });

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setQuery(queryInput.trim());
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>DPC 電子点数表</h1>
        <div className="page__header-actions">
          <Link className="button" to="/master-import">
            取込
          </Link>
        </div>
      </div>

      <ErrorBanner error={editions.error ?? list.error} />

      <table className="patient-table">
        <thead>
          <tr>
            <th>版</th>
            <th>ファイル</th>
            <th>取込日時</th>
            <th>分類</th>
            <th>変換テーブル</th>
          </tr>
        </thead>
        <tbody>
          {(editions.data ?? []).map((edition) => (
            <tr key={edition.edition}>
              <td>{edition.edition}</td>
              <td>{edition.source_filename ?? "-"}</td>
              <td>{formatDateTime(edition.imported_at)}</td>
              <td>{edition.counts.classification ?? "-"}</td>
              <td>{edition.counts.conversion ?? "-"}</td>
            </tr>
          ))}
          {editions.data?.length === 0 && (
            <tr>
              <td colSpan={5} className="patient-table__empty">
                取り込んだ版はありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="master-search__form master-search__form--row" onSubmit={handleSearch}>
        <label>
          分類
          <input value={queryInput} onChange={(e) => setQueryInput(e.target.value)} />
        </label>
        <button type="submit">検索</button>
      </form>

      {list.data && list.data.classifications.length > 0 && (
        <div className="dpc-tables__classifications">
          {list.data.classifications.map((c) => (
            <button
              key={c.code}
              type="button"
              className={c.code === mdc6 ? "rp-card__compact-button is-active" : "rp-card__compact-button"}
              onClick={() => setMdc6(c.code)}
            >
              {c.code} {c.name}
            </button>
          ))}
        </div>
      )}

      {mdc6 && list.data && (
        <table className="patient-table dpc-coding__simulation">
          <thead>
            <tr>
              <th>14 桁</th>
              <th>手術</th>
              <th>処置等1</th>
              <th>処置等2</th>
              <th>副傷病・重症度</th>
              <th>入院日Ⅰ/Ⅱ/Ⅲ</th>
              <th>点数Ⅰ/Ⅱ/Ⅲ</th>
            </tr>
          </thead>
          <tbody>
            {list.data.points.map((row) => (
              <tr key={row.dpc_code}>
                <td className="dpc-coding__code">{row.dpc_code}</td>
                <td>{row.names.surgery}</td>
                <td>{row.names.proc1}</td>
                <td>{row.names.proc2}</td>
                <td>{[row.names.comorbidity, row.names.severity].filter(Boolean).join(" / ")}</td>
                <td>{row.bundled ? row.days.map((d) => d ?? "-").join(" / ") : "出来高"}</td>
                <td>{row.bundled ? row.points.map((p) => p?.toLocaleString() ?? "-").join(" / ") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
