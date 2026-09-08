import { useState } from "react";
import type { CtcaeTerm } from "../api/masterClient";
import { useCtcaeSocs, useCtcaeTermSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// CTCAE(有害事象共通用語規準)の用語を選ぶ。有害事象の記録とレジメンマスタの
// 「想定される副作用」の両方から開く(docs/chemo-regimen-design.md §8.11)。
//
// Grade の定義まで出すのは、記録するときに「この患者は Grade 2 か 3 か」を
// 定義を読みながら決めるため。用語だけ選んで別画面で定義を確かめる形にはしない。

interface Props {
  onSelect: (term: CtcaeTerm) => void;
  onClose: () => void;
}

/** Grade 1〜5 のうち定義があるものだけ。 */
function gradesOf(term: CtcaeTerm): { grade: number; text: string }[] {
  return [term.grade1_ja, term.grade2_ja, term.grade3_ja, term.grade4_ja, term.grade5_ja]
    .map((text, index) => ({ grade: index + 1, text: text ?? "" }))
    .filter((g) => g.text !== "");
}

export function CtcaeTermSearchModal({ onSelect, onClose }: Props) {
  const [name, setName] = useState("");
  const [soc, setSoc] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  const socs = useCtcaeSocs(true);
  const { data, error, isPending } = useCtcaeTermSearch({ name, soc }, page, true);
  const hasNext = data ? page * data.per < data.total : false;

  function update(next: { name?: string; soc?: string }) {
    if (next.name !== undefined) setName(next.name);
    if (next.soc !== undefined) setSoc(next.soc);
    setPage(1);
  }

  return (
    <Modal title="有害事象(CTCAE)の選択" onClose={onClose} className="modal--wide">
      <div className="master-search__form">
        <label>
          用語
          <input
            type="text"
            value={name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="部分一致で検索(かな・全半角の違いは無視)"
          />
        </label>
        <label>
          器官別大分類
          <select value={soc} onChange={(e) => update({ soc: e.target.value })}>
            <option value="">すべて</option>
            {(socs.data ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorBanner error={error ?? socs.error} />

      <table className="master-search__table ctcae-search__table">
        <thead>
          <tr>
            <th>用語</th>
            <th>器官別大分類</th>
            <th className="rad-item__compact"></th>
          </tr>
        </thead>
        {/* 用語 1 件を「行 + 展開した Grade の行」の 2 行で表すので、組を tbody で括る
            (レジメン編集の薬剤行と同じ手法)。 */}
        {(data?.items ?? []).map((term) => (
          <tbody key={term.id} className="ctcae-search__group">
              <tr>
              <td>
                <button type="button" className="ctcae-search__term" onClick={() => onSelect(term)}>
                    {term.term_ja}
                  </button>
                  {term.term_en && <span className="lab-order-item__code">{term.term_en}</span>}
                </td>
                <td>{term.soc_ja ?? "-"}</td>
                <td className="rad-item__compact">
                  <button
                    type="button"
                    className="rp-card__compact-button"
                    onClick={() => setExpanded(expanded === term.id ? null : term.id)}
                  >
                    {expanded === term.id ? "閉じる" : "Grade"}
                  </button>
                </td>
              </tr>
              {expanded === term.id && (
                <tr className="ctcae-search__detail-row">
                  <td colSpan={3}>
                    {term.definition_ja && <p className="ctcae-search__definition">{term.definition_ja}</p>}
                    <dl className="ctcae-search__grades">
                      {gradesOf(term).map((g) => (
                        <div key={g.grade} className="ctcae-search__grade">
                          <dt>Grade {g.grade}</dt>
                          <dd>{g.text}</dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                </tr>
            )}
          </tbody>
        ))}
        {!isPending && (data?.items.length ?? 0) === 0 && (
          <tbody>
            <tr>
              <td colSpan={3} className="master-search__empty">
                該当する用語がありません
              </td>
            </tr>
          </tbody>
        )}
      </table>

      <div className="master-search__pager">
        <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
          前へ
        </button>
        <span>{data ? `${data.total} 件` : ""}</span>
        <button type="button" onClick={() => setPage((p) => p + 1)} disabled={!hasNext}>
          次へ
        </button>
      </div>
    </Modal>
  );
}
