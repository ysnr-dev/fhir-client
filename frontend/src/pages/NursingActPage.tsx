import { useState, type FormEvent } from "react";
import { useNursingActLevels, useNursingActSearch } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";

// MEDIS 看護実践用語標準マスター(看護行為編)の閲覧。配布ファイルを取込で
// 洗い替えるだけなので、この画面は読むだけで登録・編集は持たない。
export function NursingActPage() {
  const levels = useNursingActLevels();
  const [level1, setLevel1] = useState("");
  const [level2, setLevel2] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);

  const list = useNursingActSearch({ name, level1_code: level1, level2_code: level2 }, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;
  const level2Options = levels.data?.levels.find((l) => l.code === level1)?.children ?? [];

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(nameInput);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>看護行為マスタ</h1>
      </div>

      <ErrorBanner error={levels.error} />

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          第1階層
          <select
            value={level1}
            onChange={(e) => {
              setLevel1(e.target.value);
              setLevel2("");
              setPage(1);
            }}
          >
            <option value="">すべて</option>
            {levels.data?.levels.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code} {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          第2階層
          <select
            value={level2}
            onChange={(e) => {
              setLevel2(e.target.value);
              setPage(1);
            }}
            disabled={!level1}
          >
            <option value="">すべて</option>
            {level2Options.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code} {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          名称
          <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setNameInput("");
              setName("");
              setLevel1("");
              setLevel2("");
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
            <th className="rad-code__compact">16桁コード</th>
            <th className="rad-code__compact">管理番号</th>
            <th>第1階層</th>
            <th>第2階層</th>
            <th>行為名称</th>
            <th>修飾語</th>
            <th>定義</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((act) => (
            <tr key={act.id}>
              <td className="rad-code__compact">{act.code_16}</td>
              <td className="rad-code__compact">{act.manage_no}</td>
              <td>{act.level1_name}</td>
              <td>{act.level2_name}</td>
              <td>{act.level3_name}</td>
              <td>{act.level4_name}</td>
              <td>{act.level4_definition || act.level3_definition}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={7} className="master-search__empty">
                用語がありません。マスタ取込で看護行為編(koui-ver.*.txt)を取り込んでください。
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
