import { useState } from "react";
import type { Modifier } from "../api/masterClient";
import { useModifierSearch } from "../api/masterQueries";
import { modifierCategoryLabel } from "../fhir/conditionHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface ModifierSearchModalProps {
  title: string;
  onSelect: (modifier: Modifier) => void;
  onClose: () => void;
}

export function ModifierSearchModal({ title, onSelect, onClose }: ModifierSearchModalProps) {
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isFetching } = useModifierSearch(name, page, true);

  function handleNameChange(value: string) {
    setName(value);
    setPage(1);
  }

  const hasNext = data ? page * data.per < data.total : false;

  return (
    <Modal title={title} onClose={onClose} className="modal--wide">
      <div className="master-search__form">
        <label>
          修飾語
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="部分一致で検索(索引語・かな・全半角の違いも吸収)"
          />
        </label>
      </div>
      <ErrorBanner error={error} />
      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>修飾語</th>
              <th>カナ</th>
              <th>分類</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((modifier) => (
              <tr key={modifier.id}>
                <td>{modifier.name}</td>
                <td>{modifier.name_kana}</td>
                <td>{modifierCategoryLabel(modifier.modifier_category)}</td>
                <td className="master-search__actions">
                  <button type="button" onClick={() => onSelect(modifier)}>
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={4} className="master-search__empty">
                  該当する修飾語がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="master-search__pager">
        <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || isFetching}>
          前へ
        </button>
        <span>{page} ページ目 (全 {data?.total ?? 0} 件)</span>
        <button type="button" onClick={() => setPage((p) => p + 1)} disabled={!hasNext || isFetching}>
          次へ
        </button>
      </div>
    </Modal>
  );
}
