import { useState } from "react";
import type { Medicine } from "../api/masterClient";
import { useMedicineSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface MedicineSearchModalProps {
  onSelect: (medicine: Medicine) => void;
  onClose: () => void;
}

export function MedicineSearchModal({ onSelect, onClose }: MedicineSearchModalProps) {
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isFetching } = useMedicineSearch(name, page, true);

  function handleNameChange(value: string) {
    setName(value);
    setPage(1);
  }

  const hasNext = data ? page * data.per < data.total : false;

  return (
    <Modal title="医薬品を選択" onClose={onClose}>
      <div className="master-search__form">
        <label>
          医薬品名
          <input
            type="text"
            value={name}
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
              <th>医薬品コード</th>
              <th>名称</th>
              <th>単位</th>
              <th>剤形</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((medicine) => (
              <tr key={medicine.id}>
                <td>{medicine.medicine_code}</td>
                <td>{medicine.name}</td>
                <td>{medicine.unit_name}</td>
                <td>{medicine.dosage_form}</td>
                <td>
                  <button type="button" onClick={() => onSelect(medicine)}>
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="master-search__empty">
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
