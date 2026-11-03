import { useState } from "react";
import type { BomAssessment, BomOutcome } from "../api/masterClient";
import { useBomAssessmentSearch, useBomOutcomeSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// BOM(Basic Outcome Master®)のアウトカム・観察項目を選ぶ。パス定義の編集で、コード体系に BOM を
// 選んだアウトカム・観察項目のコード欄から開く(docs/clinical-pathway-design.md §3.3)。

type Props =
  | { kind: "outcome"; onSelect: (item: BomOutcome) => void; onClose: () => void }
  | { kind: "assessment"; onSelect: (item: BomAssessment) => void; onClose: () => void };

export function BomSearchModal(props: Props) {
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const outcomes = useBomOutcomeSearch({ name }, page, props.kind === "outcome");
  const assessments = useBomAssessmentSearch({ name }, page, props.kind === "assessment");
  const result = props.kind === "outcome" ? outcomes : assessments;
  const hasNext = result.data ? page * result.data.per < result.data.total : false;

  return (
    <Modal
      title={props.kind === "outcome" ? "BOM アウトカムの選択" : "BOM 観察項目の選択"}
      onClose={props.onClose}
      className="modal--wide"
    >
      <div className="master-search__form">
        <label>
          名称
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

      <ErrorBanner error={result.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>コード</th>
            <th>名称</th>
            <th>分類</th>
            {props.kind === "assessment" && <th>MEDIS 看護観察</th>}
          </tr>
        </thead>
        <tbody>
          {props.kind === "outcome" &&
            (outcomes.data?.items ?? []).map((item) => (
              <tr key={item.id}>
                <td>
                  <button type="button" className="ctcae-search__term" onClick={() => props.onSelect(item)}>
                    {item.outcome_code}
                  </button>
                </td>
                <td>{item.outcome_name}</td>
                <td>
                  {[item.category_name, item.subcategory_name].filter(Boolean).join(" / ")}
                  {item.subcategory_code && <span className="lab-order-item__code">{item.subcategory_code}</span>}
                </td>
              </tr>
            ))}
          {props.kind === "assessment" &&
            (assessments.data?.items ?? []).map((item) => (
              <tr key={item.id}>
                <td>
                  <button type="button" className="ctcae-search__term" onClick={() => props.onSelect(item)}>
                    {item.assessment_code}
                  </button>
                </td>
                <td>
                  {item.name}
                  {item.name2 && <span className="lab-order-item__code">{item.name2}</span>}
                </td>
                <td>
                  {item.category_name}
                  {item.category_code && <span className="lab-order-item__code">{item.category_code}</span>}
                </td>
                <td>
                  {item.medis_name}
                  {item.medis_manage_no && <span className="lab-order-item__code">{item.medis_manage_no}</span>}
                </td>
              </tr>
            ))}
          {!result.isPending && (result.data?.items.length ?? 0) === 0 && (
            <tr>
              <td colSpan={props.kind === "assessment" ? 4 : 3} className="master-search__empty">
                該当する項目がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="master-search__pager">
        <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
          前へ
        </button>
        <span>{result.data ? `${result.data.total} 件` : ""}</span>
        <button type="button" onClick={() => setPage((p) => p + 1)} disabled={!hasNext}>
          次へ
        </button>
      </div>
    </Modal>
  );
}
