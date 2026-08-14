import { useState, type FormEvent } from "react";
import type { RadMaterial } from "../api/masterClient";
import { useRadMaterialSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 放射線器材の施設マスタから 1 件選ぶ。実施入力用データセットに器材を積むときと、
// 実施入力で器材を足すときに使う。選ぶのは実際に購入している製品で、算定に使う
// 特定器材コードは製品に紐付いている(未紐付けの製品もある)。

interface Props {
  onSelect: (material: RadMaterial) => void;
  onClose: () => void;
}

export function RadMaterialSearchModal({ onSelect, onClose }: Props) {
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);

  // 名称が空でも一覧を出す。施設マスタは件数が少なく、一覧から選べた方が早い。
  const list = useRadMaterialSearch({ name, active: true }, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(input);
    setPage(1);
  }

  return (
    <Modal title="放射線器材を検索" onClose={onClose} className="modal--lab-order-item">
      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          製品名・カナ
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="カテーテル、ガイドワイヤ など"
          />
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
        </div>
      </form>

      <ErrorBanner error={list.error} />

      <div className="lab-order-item__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>コード</th>
              <th>製品名</th>
              <th>メーカー</th>
              <th>型番</th>
              <th className="rad-item__compact">単位</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((material) => (
              <tr key={material.id} className="master-search__row" onClick={() => onSelect(material)}>
                <td>{material.material_code}</td>
                <td>{material.name}</td>
                <td>{material.maker}</td>
                <td>{material.model_number}</td>
                <td className="rad-item__compact">{material.unit_name}</td>
              </tr>
            ))}
            {list.data && list.data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="master-search__empty">
                  該当する器材がありません
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
