import { useState } from "react";
import type { MedicineUsage } from "../api/masterClient";
import {
  useMedicineUsageCategories,
  useMedicineUsageSearch,
  type MedicineUsageFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface UsageSearchModalProps {
  onSelect: (usage: MedicineUsage) => void;
  onClose: () => void;
  initialFilters?: MedicineUsageFilters;
}

// 服用回数は usage_code の 4 桁目。1-9 は「1日N回」、0 は回数指定なし、
// A などのそれ以外は生の値をそのまま補足表示する。
function doseCountLabel(code: string): string {
  if (code === "0") return "回数指定なし";
  if (/^[1-9]$/.test(code)) return `1日${code}回`;
  return `その他 (${code})`;
}

export function UsageSearchModal({ onSelect, onClose, initialFilters }: UsageSearchModalProps) {
  const [usageName, setUsageName] = useState("");
  const [basicUsageCategory, setBasicUsageCategory] = useState(initialFilters?.basicUsageCategory ?? "");
  const [detailedUsageCategory, setDetailedUsageCategory] = useState(
    initialFilters?.detailedUsageCategory ?? "",
  );
  const [timingCategory, setTimingCategory] = useState(initialFilters?.timingCategory ?? "");
  const [doseCount, setDoseCount] = useState(initialFilters?.doseCount ?? "");
  const [page, setPage] = useState(1);
  const isPreset = Boolean(
    initialFilters?.basicUsageCategory ||
      initialFilters?.detailedUsageCategory ||
      initialFilters?.timingCategory ||
      initialFilters?.doseCount,
  );

  const filters = { basicUsageCategory, detailedUsageCategory, timingCategory, doseCount };
  const { data, error, isFetching } = useMedicineUsageSearch(usageName, filters, page, true);
  const categories = useMedicineUsageCategories(true);

  function handleNameChange(value: string) {
    setUsageName(value);
    setPage(1);
  }

  function handleFilterChange(setter: (value: string) => void, value: string) {
    setter(value);
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
        {isPreset && (
          <p className="master-search__preset-hint">
            選択した医薬品の剤形から区分を自動設定しました（変更・解除できます）
          </p>
        )}
        <div className="master-search__filters">
          <label>
            基本用法区分
            <select
              value={basicUsageCategory}
              onChange={(e) => handleFilterChange(setBasicUsageCategory, e.target.value)}
            >
              <option value="">すべて</option>
              {categories.data?.basic_usage_categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            用法詳細区分
            <select
              value={detailedUsageCategory}
              onChange={(e) => handleFilterChange(setDetailedUsageCategory, e.target.value)}
            >
              <option value="">すべて</option>
              {categories.data?.detailed_usage_categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            タイミング指定区分
            <select
              value={timingCategory}
              onChange={(e) => handleFilterChange(setTimingCategory, e.target.value)}
            >
              <option value="">すべて</option>
              {categories.data?.timing_categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            1日の服用回数
            <select
              value={doseCount}
              onChange={(e) => handleFilterChange(setDoseCount, e.target.value)}
            >
              <option value="">すべて</option>
              {categories.data?.dose_counts.map((c) => (
                <option key={c} value={c}>
                  {doseCountLabel(c)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <ErrorBanner error={error ?? categories.error} />
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
