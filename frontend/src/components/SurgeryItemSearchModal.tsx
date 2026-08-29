import { useState, type FormEvent } from "react";
import type { SurgeryItem } from "../api/masterClient";
import {
  useSurgeryCategoryOptions,
  useSurgeryItemSearch,
  type SurgeryItemFilters,
} from "../api/masterQueries";
import { surgeryApproachDisplay } from "../fhir/surgeryOrderHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import {
  renderSurgeryCategoryOptions,
  surgeryCategoryName,
  surgeryCategoryPathName,
} from "./surgeryCategoryOptions";

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
  // 術式は数が多く名称だけで探すのは辛いので、種別(部位の分類)でも絞れるようにする。
  const categories = useSurgeryCategoryOptions();
  const categoryItems = categories.data?.items ?? [];
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
        <label>
          種別
          {/* 上位の分類を選ぶと配下の分類の術式もまとめて出る。 */}
          <select
            value={inputs.categoryCode ?? ""}
            onChange={(e) => {
              const categoryCode = e.target.value;
              setInputs({ ...inputs, categoryCode });
              // 種別は選んだその場で効かせる(名称と違い打ち終わりが無いため)。
              setFilters({ ...inputs, categoryCode, active: true });
              setPage(1);
            }}
          >
            <option value="">すべて</option>
            {renderSurgeryCategoryOptions(categoryItems)}
          </select>
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

      <ErrorBanner error={list.error ?? categories.error} />

      <div className="lab-order-item__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>コード</th>
              <th>名称</th>
              <th className="rad-item__compact">種別</th>
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
                  {/* 末端の分類名だけでは上位が分からないので、道筋は title に持たせる。 */}
                  <td
                    className="rad-item__compact"
                    title={surgeryCategoryPathName(categoryItems, item.category_code)}
                  >
                    {surgeryCategoryName(categoryItems, item.category_code)}
                  </td>
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
                <td colSpan={5} className="master-search__empty">
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
