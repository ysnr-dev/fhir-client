import { useState, type FormEvent } from "react";
import type { RadFrequentCode } from "../api/masterClient";
import {
  useRadFrequentCodeSearch,
  useRadJj1017Catalog,
  type RadFrequentCodeFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

const CATEGORY_LABELS: Record<string, string> = {
  rad_exam: "放射線検査",
  ultrasound: "超音波検査",
  radiotherapy: "放射線治療",
};

interface Props {
  /**
   * true なら複数選択(オーダー項目の一括作成用)、false なら1件選んで閉じる
   * (編集中の項目に要素を反映する用)。
   */
  multiple?: boolean;
  onSelect?: (code: RadFrequentCode) => void;
  onConfirm?: (codes: RadFrequentCode[]) => void;
  onClose: () => void;
  pending?: boolean;
}

// JJ1017 の代表的頻用コード集(別表F)から選ぶ。頻用コードは部品コードを
// 組み合わせた32桁コードなので、選べばそのままオーダー項目の要素になる。
export function RadFrequentCodeSearchModal({
  multiple = false,
  onSelect,
  onConfirm,
  onClose,
  pending = false,
}: Props) {
  const [inputs, setInputs] = useState<RadFrequentCodeFilters>({
    category: "rad_exam",
    unregisteredOnly: multiple,
  });
  const [filters, setFilters] = useState<RadFrequentCodeFilters>(inputs);
  const [page, setPage] = useState(1);
  // ページをまたいでも選択を保つため、id → コードで持つ。
  const [selected, setSelected] = useState<Map<number, RadFrequentCode>>(new Map());

  const catalog = useRadJj1017Catalog();
  const list = useRadFrequentCodeSearch(filters, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  function toggle(code: RadFrequentCode) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(code.id)) next.delete(code.id);
      else next.set(code.id, code);
      return next;
    });
  }

  return (
    <Modal
      title={multiple ? "頻用コード表から一括作成" : "頻用コード表から検索"}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          区分
          <select
            value={inputs.category ?? ""}
            onChange={(e) => setInputs({ ...inputs, category: e.target.value })}
          >
            <option value="">すべて</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          種別(モダリティ)
          <select
            value={inputs.modalityCode ?? ""}
            onChange={(e) => setInputs({ ...inputs, modalityCode: e.target.value })}
          >
            <option value="">すべて</option>
            {catalog.data?.modality?.map((modality) => (
              <option key={modality.code} value={modality.code}>
                {modality.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          コード意味
          <input
            type="text"
            value={inputs.name ?? ""}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
          />
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={inputs.unregisteredOnly ?? false}
            onChange={(e) => setInputs({ ...inputs, unregisteredOnly: e.target.checked })}
          />
          未登録のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
        </div>
      </form>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            {multiple && <th className="rad-code__compact"></th>}
            <th>コード意味</th>
            <th className="rad-frequent__code">JJ1017-32</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((code) => (
            <tr
              key={code.id}
              className="master-search__row"
              onClick={() => (multiple ? toggle(code) : onSelect?.(code))}
            >
              {multiple && (
                <td className="rad-code__compact">
                  <input
                    type="checkbox"
                    checked={selected.has(code.id)}
                    onChange={() => toggle(code)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
              )}
              <td>{code.name}</td>
              <td className="rad-frequent__code">{code.jj1017_code}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={multiple ? 3 : 2} className="master-search__empty">
                頻用コードがありません。マスタ取込で JJ1017 の別表F を取り込んでください。
              </td>
            </tr>
          )}
        </tbody>
      </table>

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

      {multiple && (
        <div className="lab-order-item__actions">
          <button
            type="button"
            disabled={selected.size === 0 || pending}
            onClick={() => onConfirm?.(Array.from(selected.values()))}
          >
            {pending ? "作成中..." : `選択した ${selected.size} 件を作成`}
          </button>
          <button type="button" onClick={() => setSelected(new Map())} disabled={selected.size === 0}>
            選択を解除
          </button>
        </div>
      )}
    </Modal>
  );
}
