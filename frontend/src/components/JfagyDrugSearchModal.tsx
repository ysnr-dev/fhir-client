import { useState } from "react";
import type { JfagyDrug } from "../api/masterClient";
import { useJfagyDrugSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface JfagyDrugSearchModalProps {
  onSelect: (drug: JfagyDrug) => void;
  onClose: () => void;
}

// 剤形・規格・銘柄不明コードマスタ(J-FAGY医薬品領域)の検索モーダル。
// 銘柄まで特定できない薬剤アレルゲンを成分名で選ぶ。
export function JfagyDrugSearchModal({ onSelect, onClose }: JfagyDrugSearchModalProps) {
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);

  const { data, error, isFetching } = useJfagyDrugSearch(name, page, true);

  function handleNameChange(value: string) {
    setName(value);
    setPage(1);
  }

  const hasNext = data ? page * data.per < data.total : false;

  return (
    <Modal title="医薬品を選択(剤形・規格・銘柄不明)" onClose={onClose} className="modal--wide">
      <div className="master-search__form">
        <label>
          薬剤成分名
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="部分一致で検索(かな・全半角の違いも吸収)"
          />
        </label>
      </div>
      <ErrorBanner error={error} />
      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>コード</th>
              <th>薬剤成分名</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((drug) => (
              <tr key={drug.id}>
                <td>{drug.jfagy_code}</td>
                <td>{drug.name}</td>
                <td className="master-search__actions">
                  <button type="button" onClick={() => onSelect(drug)}>
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={3} className="master-search__empty">
                  該当する医薬品がありません
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
