import { useState } from "react";
import { usePathoOrganSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 病理検査オーダーの臓器・検査材料の選択。頻用臓器のボタンに無い臓器を
// JAHIS テーブル LPATHO003(約 530 件)の全件から名称・ICD-10 で検索して選ぶ。
export function PathoOrganSearchModal({
  onSelect,
  onClose,
}: {
  onSelect: (organ: { code: string; name: string }) => void;
  onClose: () => void;
}) {
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const search = usePathoOrganSearch({ name }, page);
  const hasNext = search.data ? page * search.data.per < search.data.total : false;

  function runSearch() {
    setName(nameInput);
    setPage(1);
  }

  return (
    <Modal title="臓器・検査材料を検索" onClose={onClose}>
      {/* オーダーフォーム(form 要素)の中に出すモーダルなので、form の入れ子を作らない
          (入れ子は外側フォームのネイティブ submit を誘発する)。 */}
      <div className="patient-search-form">
        <label>
          臓器名・ICD-10
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
            <th>臓器・検査材料</th>
            <th className="rad-code__compact">ICD-10</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {search.data?.items.map((organ) => (
            <tr key={organ.id}>
              <td className="rad-code__compact">{organ.code}</td>
              <td>{organ.name}</td>
              <td className="rad-code__compact">{organ.icd10 ?? ""}</td>
              <td>
                <button
                  type="button"
                  onClick={() => onSelect({ code: organ.code, name: organ.name })}
                >
                  選択
                </button>
              </td>
            </tr>
          ))}
          {search.data && search.data.items.length === 0 && (
            <tr>
              <td colSpan={4} className="master-search__empty">
                該当する臓器がありません。
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
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasNext || search.isFetching}
        >
          次へ
        </button>
      </div>
    </Modal>
  );
}
