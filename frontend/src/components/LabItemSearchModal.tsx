import { useState } from "react";
import type { LabItem } from "../api/masterClient";
import { useLabItemCategories, useLabItemSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface LabItemSearchModalProps {
  onSelect: (item: LabItem) => void;
  onClose: () => void;
}

export function LabItemSearchModal({ onSelect, onClose }: LabItemSearchModalProps) {
  const [name, setName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isFetching } = useLabItemSearch(name, categoryName, page, true);
  const categories = useLabItemCategories(true);

  function handleNameChange(value: string) {
    setName(value);
    setPage(1);
  }

  function handleCategoryChange(value: string) {
    setCategoryName(value);
    setPage(1);
  }

  const hasNext = data ? page * data.per < data.total : false;

  return (
    <Modal title="検査項目を選択" onClose={onClose} className="modal--wide">
      <div className="master-search__form">
        <label>
          検査項目名称
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="名称・略称の部分一致で検索(かな・全半角の違いは無視)"
          />
        </label>
        <label>
          区分名称
          <select value={categoryName} onChange={(e) => handleCategoryChange(e.target.value)}>
            <option value="">すべて</option>
            {categories.data?.category_names.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorBanner error={error ?? categories.error} />
      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>区分名称</th>
              <th>検査項目名称</th>
              <th>材料</th>
              <th>測定法</th>
              <th>単位</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr key={item.id}>
                <td>{item.category_name}</td>
                <td>{item.fhir_item_name}</td>
                <td>{item.jlac11_specimen}</td>
                <td>{item.jlac11_method}</td>
                <td>{item.display_unit}</td>
                <td className="master-search__actions">
                  <button type="button" onClick={() => onSelect(item)}>
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="master-search__empty">
                  該当する検査項目がありません
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
