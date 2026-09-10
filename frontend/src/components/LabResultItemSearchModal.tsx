import { useState, type KeyboardEvent } from "react";
import type { LabResultItem } from "../api/masterClient";
import { useLabResultItemSearch, type LabResultItemFilters } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { LAB_CATEGORIES } from "./labOrderItemOptions";
import { Modal } from "./Modal";

interface Props {
  /** 見出し。何に足すのかは呼び出し元で変わる。 */
  title?: string;
  onSelect: (item: LabResultItem) => void;
  onClose: () => void;
}

// 検体検査の結果項目(施設マスタ)を検査分野・データ型・名称で探して1件選ぶ。
// 検査結果フォームの項目選択と、オーダー項目の対応づけから使う。
export function LabResultItemSearchModal({
  title = "検査結果項目を選択",
  onSelect,
  onClose,
}: Props) {
  const [inputs, setInputs] = useState<LabResultItemFilters>({ active: true });
  const [filters, setFilters] = useState<LabResultItemFilters>({ active: true });
  const [page, setPage] = useState(1);

  const list = useLabResultItemSearch(filters, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch() {
    setFilters(inputs);
    setPage(1);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    // 検査結果フォームの中から開くモーダルなので、外側フォームへ Enter を渡さない。
    e.preventDefault();
    handleSearch();
  }

  return (
    <Modal title={title} onClose={onClose} className="modal--lab-order-item">
      {/* Modal は非ポータルで検査結果フォームの中に描画されるため、form を入れ子にしない
          (submit ボタンだと外側フォームがネイティブ submit されて入力が消える)。 */}
      <div className="patient-search-form">
        <label>
          名称・略称・カナ
          <input
            type="text"
            value={inputs.name ?? ""}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
            onKeyDown={handleKeyDown}
          />
        </label>
        <label>
          検査分野
          <select
            value={inputs.category ?? ""}
            onChange={(e) => setInputs({ ...inputs, category: e.target.value })}
          >
            <option value="">すべて</option>
            {LAB_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={inputs.active ?? false}
            onChange={(e) => setInputs({ ...inputs, active: e.target.checked })}
          />
          有効期間内のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={handleSearch}>
            検索
          </button>
          <button
            type="button"
            onClick={() => {
              setInputs({ active: true });
              setFilters({ active: true });
              setPage(1);
            }}
          >
            クリア
          </button>
        </div>
      </div>

      <ErrorBanner error={list.error} />

      <div className="lab-order-item__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>名称</th>
              <th>略称</th>
              <th>検査分野</th>
              <th>材料</th>
              <th>単位</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((item) => (
              <tr key={item.id} className="master-search__row" onClick={() => onSelect(item)}>
                <td>{item.name}</td>
                <td>{item.short_name}</td>
                <td>{item.category}</td>
                <td>{item.specimen_name ?? item.specimen_code}</td>
                <td>{item.display_unit}</td>
              </tr>
            ))}
            {list.data && list.data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="master-search__empty">
                  該当する項目がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
    </Modal>
  );
}
