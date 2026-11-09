import { useState, type FormEvent } from "react";
import type { BloodPurifier } from "../api/masterClient";
import { useBloodPurifierSearch } from "../api/masterQueries";
import {
  BLOOD_PURIFIER_KIND_OPTIONS,
  bloodPurifierKindDisplay,
  bloodPurifierMembraneLabel,
} from "../fhir/bloodPurifierHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 血液浄化器の施設マスタから 1 件選ぶ。

interface Props {
  /** 最初に絞り込む種別。空ならすべて。 */
  initialKind: string;
  onSelect: (purifier: BloodPurifier) => void;
  onClose: () => void;
}

export function BloodPurifierSearchModal({ initialKind, onSelect, onClose }: Props) {
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState(initialKind);
  const [page, setPage] = useState(1);

  // 名称が空でも一覧を出す。施設マスタは件数が少なく、一覧から選べた方が早い。
  const list = useBloodPurifierSearch({ name, kind, active: true }, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(input);
    setPage(1);
  }

  return (
    <Modal title="血液浄化器を検索" onClose={onClose} className="modal--lab-order-item">
      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          種別
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">すべて</option>
            {BLOOD_PURIFIER_KIND_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          製品名・カナ
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} />
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
              <th>種別</th>
              <th>製品名</th>
              <th className="rad-item__compact">膜</th>
              <th>メーカー</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((purifier) => (
              <tr key={purifier.id} className="master-search__row" onClick={() => onSelect(purifier)}>
                <td>{bloodPurifierKindDisplay(purifier.kind)}</td>
                <td>{purifier.name}</td>
                <td className="rad-item__compact">{bloodPurifierMembraneLabel(purifier)}</td>
                <td>{purifier.maker}</td>
              </tr>
            ))}
            {list.data && list.data.items.length === 0 && (
              <tr>
                <td colSpan={4} className="master-search__empty">
                  該当する血液浄化器がありません
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
