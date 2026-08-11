import { useState } from "react";
import { useMicroOrganismSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 細菌検査結果の分離菌の選択。頻用プルダウンに無い菌を JANIS 病原体コード表の
// 全件から名称検索で選ぶ。
export function MicroOrganismSearchModal({
  onSelect,
  onClose,
}: {
  onSelect: (organism: { code: string; name: string }) => void;
  onClose: () => void;
}) {
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const search = useMicroOrganismSearch({ name }, page);
  const hasNext = search.data ? page * search.data.per < search.data.total : false;

  function runSearch() {
    setName(nameInput);
    setPage(1);
  }

  return (
    <Modal title="分離菌を検索" onClose={onClose}>
      {/* 結果フォーム(form 要素)の中に出すモーダルなので、form の入れ子を作らない
          (入れ子は外側フォームのネイティブ submit を誘発する)。LabItemSearchModal と同じ。 */}
      <div className="patient-search-form">
        <label>
          菌名
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={runSearch}>
            検索
          </button>
        </div>
      </div>

      <ErrorBanner error={search.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>菌名</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {search.data?.items.map((organism) => (
            <tr key={organism.id}>
              <td className="rad-code__compact">{organism.code}</td>
              <td>{organism.name}</td>
              <td>
                <button
                  type="button"
                  onClick={() => onSelect({ code: organism.code, name: organism.name })}
                >
                  選択
                </button>
              </td>
            </tr>
          ))}
          {search.data && search.data.items.length === 0 && (
            <tr>
              <td colSpan={3} className="master-search__empty">
                該当する菌がありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="master-search__pager">
        <button
          type="button"
          onClick={() => setPage((p) => p - 1)}
          disabled={page <= 1 || search.isFetching}
        >
          前へ
        </button>
        <span>
          {page} ページ目 (全 {search.data?.total ?? 0} 件)
        </span>
        <button type="button" onClick={() => setPage((p) => p + 1)} disabled={!hasNext || search.isFetching}>
          次へ
        </button>
      </div>
    </Modal>
  );
}
