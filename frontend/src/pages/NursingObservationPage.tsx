import { useState, type FormEvent } from "react";
import { useNursingObservationSearch } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { NURSING_OBSERVATION_CATEGORIES, nursingObservationResults } from "../components/nursingItemOptions";

// MEDIS 看護実践用語標準マスター(看護観察編)の閲覧。読むだけで登録・編集は持たない。
export function NursingObservationPage() {
  const [category, setCategory] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);

  const list = useNursingObservationSearch({ name, category }, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(nameInput);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>看護観察マスタ</h1>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          検索大分類
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">すべて</option>
            {NURSING_OBSERVATION_CATEGORIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}. {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          名称・かな
          <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setNameInput("");
              setName("");
              setCategory("");
              setPage(1);
            }}
          >
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">管理番号</th>
            <th>観察名称</th>
            <th>焦点 / 部位 / 位相</th>
            <th className="rad-code__compact">表現タイプ</th>
            <th className="rad-code__compact">単位</th>
            <th>結果</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((obs) => (
            <tr key={obs.id}>
              <td className="rad-code__compact">{obs.manage_no}</td>
              <td>{obs.name}</td>
              <td>{[obs.focus, obs.site, obs.phase, obs.other].filter(Boolean).join(" / ")}</td>
              <td className="rad-code__compact">{obs.expression_type}</td>
              <td className="rad-code__compact">{obs.unit}</td>
              <td>{nursingObservationResults(obs).join("、")}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={6} className="master-search__empty">
                用語がありません。マスタ取込で看護観察編(kansatsu-ver.*.txt)を取り込んでください。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="master-search__pager">
        <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || list.isFetching}>
          前へ
        </button>
        <span>
          {page} ページ目 (全 {list.data?.total ?? 0} 件)
        </span>
        <button type="button" onClick={() => setPage((p) => p + 1)} disabled={!hasNext || list.isFetching}>
          次へ
        </button>
      </div>
    </div>
  );
}
