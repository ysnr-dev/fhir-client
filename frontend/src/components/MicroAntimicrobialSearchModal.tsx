import { useState } from "react";
import { useMicroAntimicrobialSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

export interface AntimicrobialSelection {
  code: string;
  name: string;
  abbreviation: string;
}

// 薬剤感受性の抗菌薬の選択。頻用プルダウンに無い薬を JANIS 抗菌薬コード表の
// 全件から名称・略号検索で選ぶ。
export function MicroAntimicrobialSearchModal({
  onSelect,
  onClose,
}: {
  onSelect: (drug: AntimicrobialSelection) => void;
  onClose: () => void;
}) {
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const search = useMicroAntimicrobialSearch({ name }, page);
  const hasNext = search.data ? page * search.data.per < search.data.total : false;

  function runSearch() {
    setName(nameInput);
    setPage(1);
  }

  return (
    <Modal title="抗菌薬を検索" onClose={onClose}>
      {/* 結果フォーム(form 要素)の中に出すモーダルなので、form の入れ子を作らない
          (入れ子は外側フォームのネイティブ submit を誘発する)。LabItemSearchModal と同じ。 */}
      <div className="patient-search-form">
        <label>
          薬剤名・略号
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
            <th>薬剤名</th>
            <th className="rad-code__compact">略号</th>
            <th>系統</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {search.data?.items.map((drug) => (
            <tr key={drug.id}>
              <td className="rad-code__compact">{drug.code}</td>
              <td>{drug.name}</td>
              <td className="rad-code__compact">{drug.abbreviation}</td>
              <td>{drug.category}</td>
              <td>
                <button
                  type="button"
                  onClick={() =>
                    onSelect({
                      code: drug.code,
                      name: drug.name,
                      abbreviation: drug.abbreviation ?? "",
                    })
                  }
                >
                  選択
                </button>
              </td>
            </tr>
          ))}
          {search.data && search.data.items.length === 0 && (
            <tr>
              <td colSpan={5} className="master-search__empty">
                該当する抗菌薬がありません。
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
