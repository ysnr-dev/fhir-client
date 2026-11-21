import { useState } from "react";
import type { PromisedPrescription } from "../api/masterClient";
import { usePromisedPrescriptionSearch } from "../api/masterQueries";
import { promisedItemsSummary } from "../fhir/promisedPrescriptionHelpers";
import { ErrorBanner } from "./ErrorBanner";

// 約束処方から選ぶモード。医薬品の検索モーダルに足す(処方オーダー)。運用期間内のものだけを並べる。

export function PromisedPrescriptionPickTable({
  onSelect,
  selecting,
}: {
  onSelect: (promised: PromisedPrescription) => void;
  /** 選択後に医薬品マスタを引いている間。二重に選ばせない。 */
  selecting?: boolean;
}) {
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isFetching } = usePromisedPrescriptionSearch({ name, active: true }, page);
  const hasNext = data ? page * data.per < data.total : false;

  return (
    <>
      <div className="master-search__form">
        <label>
          約束処方名
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setPage(1);
            }}
            placeholder="部分一致で検索(かな・全半角の違いは無視)"
          />
        </label>
      </div>
      <ErrorBanner error={error} />
      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>コード</th>
              <th>名称</th>
              <th className="rad-item__compact">基準量</th>
              <th>構成薬</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((promised) => {
              const selectable = !selecting && promised.items.length > 0;
              return (
                <tr
                  key={promised.id}
                  className={selectable ? "master-search__row" : undefined}
                  onClick={selectable ? () => onSelect(promised) : undefined}
                >
                  <td>{promised.code}</td>
                  <td>{promised.name}</td>
                  <td className="rad-item__compact">
                    {Number(promised.base_amount)}
                    {promised.unit_name}
                  </td>
                  <td>{promisedItemsSummary(promised)}</td>
                </tr>
              );
            })}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={4} className="master-search__empty">
                  該当する約束処方がありません
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
    </>
  );
}
