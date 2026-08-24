import { useState, type FormEvent } from "react";
import type { EndoscopyItem } from "../api/masterClient";
import {
  useEndoscopyExamTypeOptions,
  useEndoscopyItemSearch,
  type EndoscopyItemFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { KIND_LABELS, renderExamTypeOptions } from "./endoscopyItemOptions";

interface Props {
  /** 見出し。何に足すのかは呼び出し元で変わる。 */
  title?: string;
  /**
   * 既に使っている項目コード。行は出したうえで選べないようにする
   * (探した項目が「無い」のか「追加済み」なのかを分かるようにするため)。
   */
  excludeCodes?: string[];
  onSelect: (item: EndoscopyItem) => void;
  onClose: () => void;
}

// 内視鏡オーダー項目を検査種別・名称で探して1件選ぶ。セット構成の追加と
// オーダーレイアウトのマス配置で同じものを使う。
export function EndoscopyItemSearchModal({
  title = "内視鏡オーダー項目を選択",
  excludeCodes = [],
  onSelect,
  onClose,
}: Props) {
  const [inputs, setInputs] = useState<EndoscopyItemFilters>({});
  const [filters, setFilters] = useState<EndoscopyItemFilters>({});
  const [page, setPage] = useState(1);

  const examTypes = useEndoscopyExamTypeOptions();
  const list = useEndoscopyItemSearch(filters, page);
  const examTypeNames = list.data?.exam_types ?? {};
  const hasNext = list.data ? page * list.data.per < list.data.total : false;
  const excluded = new Set(excludeCodes);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  return (
    <Modal title={title} onClose={onClose} className="modal--lab-order-item">
      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          検査種別
          <select
            value={inputs.examTypeCode ?? ""}
            onChange={(e) => setInputs({ ...inputs, examTypeCode: e.target.value })}
          >
            <option value="">すべて</option>
            {renderExamTypeOptions(examTypes.data?.items ?? [])}
          </select>
        </label>
        <label>
          名称・略称・カナ
          <input
            type="text"
            value={inputs.name ?? ""}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
          />
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

      <ErrorBanner error={list.error ?? examTypes.error} />

      <div className="lab-order-item__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>コード</th>
              <th>名称</th>
              <th>検査種別</th>
              <th className="rad-item__compact">区分</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((item) => {
              const used = excluded.has(item.item_code);
              return (
                <tr
                  key={item.id}
                  className={used ? undefined : "master-search__row"}
                  onClick={used ? undefined : () => onSelect(item)}
                >
                  <td>{item.item_code}</td>
                  <td>{item.name}</td>
                  <td>
                    {item.exam_type_code
                      ? (examTypeNames[item.exam_type_code] ?? item.exam_type_code)
                      : ""}
                  </td>
                  <td className="rad-item__compact">{KIND_LABELS[item.kind] ?? item.kind}</td>
                  <td className="rad-item__compact">
                    {used && <span className="dose-conversion__badge">追加済</span>}
                  </td>
                </tr>
              );
            })}
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
        <button
          type="button"
          onClick={() => setPage((p) => p - 1)}
          disabled={page <= 1 || list.isFetching}
        >
          前へ
        </button>
        <span>
          {page} ページ目 (全 {list.data?.total ?? 0} 件)
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasNext || list.isFetching}
        >
          次へ
        </button>
      </div>
    </Modal>
  );
}
