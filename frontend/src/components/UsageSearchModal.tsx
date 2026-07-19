import { useState } from "react";
import type { MedicineUsage } from "../api/masterClient";
import { useMedicineUsageSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface UsageSearchModalProps {
  onSelect: (usage: MedicineUsage) => void;
  onClose: () => void;
}

export function UsageSearchModal({ onSelect, onClose }: UsageSearchModalProps) {
  const [usageName, setUsageName] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isFetching } = useMedicineUsageSearch(usageName, page, true);

  function handleNameChange(value: string) {
    setUsageName(value);
    setPage(1);
  }

  const hasNext = data ? page * data.per < data.total : false;

  return (
    <Modal title="用法を選択" onClose={onClose}>
      <div className="master-search__form">
        <label>
          用法名
          <input
            type="text"
            value={usageName}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="部分一致で検索"
          />
        </label>
      </div>
      <ErrorBanner error={error} />
      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>用法コード</th>
              <th>用法名</th>
              <th>大分類</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((usage) => (
              <tr key={usage.id}>
                <td>{usage.usage_code}</td>
                <td>{usage.usage_name}</td>
                <td>{usage.basic_usage_category}</td>
                <td>
                  <button type="button" onClick={() => onSelect(usage)}>
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={4} className="master-search__empty">
                  該当する用法がありません
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
