import { useState, type FormEvent } from "react";
import type { RadItem } from "../api/masterClient";
import { useRadItemSearch, useRadJj1017Catalog, type RadItemFilters } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { KIND_LABELS, MODALITY_BODY_PART_FLAG, renderJj1017CodeOptions } from "./radItemOptions";

interface Props {
  /** 見出し。何に足すのかは呼び出し元で変わる。 */
  title?: string;
  /**
   * 既に使っている項目コード。行は出したうえで選べないようにする
   * (探した項目が「無い」のか「追加済み」なのかを分かるようにするため)。
   */
  excludeCodes?: string[];
  onSelect: (item: RadItem) => void;
  onClose: () => void;
}

// 放射線オーダー項目をモダリティ・部位・名称で探して1件選ぶ。セット構成の追加と
// オーダーレイアウトのマス配置で同じものを使う。
export function RadItemSearchModal({
  title = "放射線オーダー項目を選択",
  excludeCodes = [],
  onSelect,
  onClose,
}: Props) {
  const [inputs, setInputs] = useState<RadItemFilters>({});
  const [filters, setFilters] = useState<RadItemFilters>({});
  const [page, setPage] = useState(1);

  const catalog = useRadJj1017Catalog();
  const list = useRadItemSearch(filters, page);
  const elementNames = list.data?.elements ?? {};
  const hasNext = list.data ? page * list.data.per < list.data.total : false;
  const excluded = new Set(excludeCodes);

  // 部位の候補は、選んでいる撮影種別で使うものから先に見せる。
  const bodyPartFlag = MODALITY_BODY_PART_FLAG[inputs.modalityCode ?? ""];

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  return (
    <Modal title={title} onClose={onClose} className="modal--lab-order-item">
      <form className="patient-search-form" onSubmit={handleSearch}>
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
        <label className="rad-item-search__body-part">
          部位
          <select
            value={inputs.bodyPartCode ?? ""}
            onChange={(e) => setInputs({ ...inputs, bodyPartCode: e.target.value })}
          >
            <option value="">すべて</option>
            {renderJj1017CodeOptions(catalog.data?.body_part ?? [], bodyPartFlag)}
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

      <ErrorBanner error={list.error ?? catalog.error} />

      <div className="lab-order-item__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>コード</th>
              <th>名称</th>
              <th>種別</th>
              <th>部位</th>
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
                    {item.modality_code
                      ? (elementNames.modality?.[item.modality_code] ?? item.modality_code)
                      : ""}
                  </td>
                  <td>
                    {item.body_part_code
                      ? (elementNames.body_part?.[item.body_part_code] ?? item.body_part_code)
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
