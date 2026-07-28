import { useState } from "react";
import type { Disease } from "../api/masterClient";
import { useDiseaseSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface DiseaseSearchModalProps {
  onSelect: (disease: Disease) => void;
  onClose: () => void;
}

export function DiseaseSearchModal({ onSelect, onClose }: DiseaseSearchModalProps) {
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isFetching } = useDiseaseSearch(name, page, true);

  function handleNameChange(value: string) {
    setName(value);
    setPage(1);
  }

  const hasNext = data ? page * data.per < data.total : false;

  return (
    <Modal title="病名を選択" onClose={onClose} className="modal--wide">
      <div className="master-search__form">
        <label>
          病名
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="部分一致で検索(索引語・かな・全半角の違いも吸収)"
          />
        </label>
      </div>
      <ErrorBanner error={error} />
      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>病名</th>
              <th>カナ</th>
              <th>ICD10</th>
              <th>交換用コード</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((disease) => (
              <tr key={disease.id}>
                <td>{disease.name}</td>
                <td>{disease.name_kana}</td>
                <td>{disease.icd10_2013}</td>
                <td>{disease.exchange_code}</td>
                <td className="master-search__actions">
                  <button type="button" onClick={() => onSelect(disease)}>
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="master-search__empty">
                  該当する病名がありません
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
