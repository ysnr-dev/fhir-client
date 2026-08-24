import { useMemo, useState, type FormEvent } from "react";
import type { LabOrderItem } from "../api/masterClient";
import {
  useLabOrderItemSearch,
  useLabSpecimenOptions,
  type LabOrderItemFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { LAB_CATEGORIES, LAB_KIND_LABELS } from "./labOrderItemOptions";
import { Modal } from "./Modal";

interface Props {
  /** 見出し。何に足すのかは呼び出し元で変わる。 */
  title?: string;
  onSelect: (item: LabOrderItem) => void;
  onClose: () => void;
}

// 検体検査オーダー項目を検査分野・種別・名称で探して1件選ぶ。オーダーレイアウトの
// マス配置から使う。放射線の RadItemSearchModal と同じ形。
export function LabOrderItemSearchModal({
  title = "検査オーダー項目を選択",
  onSelect,
  onClose,
}: Props) {
  const [inputs, setInputs] = useState<LabOrderItemFilters>({});
  const [filters, setFilters] = useState<LabOrderItemFilters>({});
  const [page, setPage] = useState(1);

  const list = useLabOrderItemSearch(filters, page);
  const specimens = useLabSpecimenOptions();
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  const specimenNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of specimens.data?.items ?? []) map.set(s.specimen_code, s.name);
    return map;
  }, [specimens.data]);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  return (
    <Modal title={title} onClose={onClose} className="modal--lab-order-item">
      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          名称・略称・カナ
          <input
            type="text"
            value={inputs.name ?? ""}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
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
        <label>
          種別
          <select
            value={inputs.kind ?? ""}
            onChange={(e) => setInputs({ ...inputs, kind: e.target.value })}
          >
            <option value="">すべて</option>
            <option value="single">単項目</option>
            <option value="panel">パネル</option>
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
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setInputs({});
              setFilters({});
              setPage(1);
            }}
          >
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={list.error ?? specimens.error} />

      <div className="lab-order-item__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>コード</th>
              <th>名称</th>
              <th>略称</th>
              <th>検査分野</th>
              <th className="lab-order-item__compact">種別</th>
              <th>検体</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((item) => (
              <tr key={item.id} className="master-search__row" onClick={() => onSelect(item)}>
                <td>{item.order_item_code}</td>
                <td>{item.name}</td>
                <td>{item.short_name}</td>
                <td>{item.category}</td>
                <td className="lab-order-item__compact">
                  {LAB_KIND_LABELS[item.kind] ?? item.kind}
                </td>
                <td>
                  {item.specimen_code
                    ? (specimenNames.get(item.specimen_code) ?? item.specimen_code)
                    : ""}
                </td>
              </tr>
            ))}
            {list.data && list.data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="master-search__empty">
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
