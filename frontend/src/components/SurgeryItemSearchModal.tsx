import { useState, type FormEvent } from "react";
import type { SurgeryItem } from "../api/masterClient";
import { useSurgeryItemSearch, type SurgeryItemFilters } from "../api/masterQueries";
import { surgeryApproachDisplay } from "../fhir/surgeryOrderHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface Props {
  /** 見出し。何に足すのかは呼び出し元で変わる。 */
  title?: string;
  /**
   * 既に使っている項目コード。行は出したうえで選べないようにする
   * (探した項目が「無い」のか「追加済み」なのかを分かるようにするため)。
   */
  excludeCodes?: string[];
  onSelect: (item: SurgeryItem) => void;
  onClose: () => void;
}

// 術式を名称で探して1件選ぶ。手術オーダー(申込)画面で使う。
// 処置と違い伝票レイアウトが無いので、術式は常にここから選ぶ。
export function SurgeryItemSearchModal({
  title = "術式を選択",
  excludeCodes = [],
  onSelect,
  onClose,
}: Props) {
  const [inputs, setInputs] = useState<SurgeryItemFilters>({});
  const [filters, setFilters] = useState<SurgeryItemFilters>({ active: true });
  const [page, setPage] = useState(1);

  const list = useSurgeryItemSearch(filters, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;
  const excluded = new Set(excludeCodes);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    // オーダー画面からの検索なので、今日オーダーできる項目だけを出す。
    setFilters({ ...inputs, active: true });
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
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setInputs({});
              setFilters({ active: true });
              setPage(1);
            }}
          >
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={list.error} />

      <div className="lab-order-item__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>コード</th>
              <th>名称</th>
              <th className="rad-item__compact">到達法(既定)</th>
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
                  <td className="rad-item__compact">
                    {surgeryApproachDisplay(item.default_approach ?? "")}
                  </td>
                  <td className="rad-item__compact">
                    {used && <span className="dose-conversion__badge">追加済</span>}
                  </td>
                </tr>
              );
            })}
            {list.data && list.data.items.length === 0 && (
              <tr>
                <td colSpan={4} className="master-search__empty">
                  該当する術式がありません
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
