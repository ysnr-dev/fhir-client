import { useState, type FormEvent } from "react";
import type { MedicalMaterial } from "../api/masterClient";
import { useMedicalMaterialSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// レセプト電算の特定器材マスタから 1 件選ぶ。放射線器材マスタで、実際の製品に
// 算定用の特定器材コードを紐付けるときに使う。
//
// 収載名は「中心静脈用カテーテル（標準・シングルルーメン）」のような概念的な区分で、
// 製品名では引けない。基本漢字名称の方が区分の意味が分かりやすいので併せて出す。

interface Props {
  onSelect: (material: MedicalMaterial) => void;
  onClose: () => void;
}

export function MedicalMaterialSearchModal({ onSelect, onClose }: Props) {
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);

  const list = useMedicalMaterialSearch({ name }, page, name.trim().length > 0);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(input);
    setPage(1);
  }

  return (
    <Modal title="特定器材コードを検索" onClose={onClose} className="modal--lab-order-item">
      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          収載名・カナ
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

      {name.trim().length === 0 ? (
        <p className="order-select__muted">収載名で検索してください</p>
      ) : (
        <>
          <div className="lab-order-item__table-wrap">
            <table className="master-search__table">
              <thead>
                <tr>
                  <th>コード</th>
                  <th>収載名</th>
                  <th>基本名称</th>
                  <th className="rad-item__compact">価格</th>
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((material) => (
                  <tr
                    key={material.id}
                    className="master-search__row"
                    onClick={() => onSelect(material)}
                  >
                    <td>{material.material_code}</td>
                    <td>{material.name}</td>
                    <td>{material.basic_name}</td>
                    <td className="rad-item__compact">
                      {material.price ? `${Number(material.price).toLocaleString()} 円` : ""}
                    </td>
                  </tr>
                ))}
                {list.data && list.data.items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="master-search__empty">
                      該当する特定器材がありません
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
        </>
      )}
    </Modal>
  );
}
