import { useState, type FormEvent } from "react";
import {
  useNursingActActionSearch,
  useNursingActLevels,
  useNursingObservationSearch,
} from "../api/masterQueries";
import type { NursingItemRef } from "../fhir/nursingOrderHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { NURSING_OBSERVATION_CATEGORIES, nursingObservationResults } from "./nursingItemOptions";

interface Props {
  onSelect: (item: NursingItemRef, display: string) => void;
  /**
   * 観察だけを選ばせるとき("observation")。タブと自由記載を出さない
   * (水分出納の対象項目のように、観察に限る設定から開く)。
   */
  only?: Tab;
  onClose: () => void;
}

type Tab = "act" | "observation";

// 看護指示の用語を MEDIS 看護実践用語標準マスター(看護行為編・看護観察編)から
// 探して 1 件選ぶ。マスタに無い指示は「自由記載」で戻す(item = null)。
export function NursingItemSearchModal({ onSelect, only, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(only ?? "act");
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [level1, setLevel1] = useState("");
  const [level2, setLevel2] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);

  const levels = useNursingActLevels();
  // 行為は第 3 階層(行為)までを出す。修飾語(第 4 階層)は選択後にフォームのセレクトで選ぶ。
  const acts = useNursingActActionSearch(
    { name, level1_code: level1, level2_code: level2 },
    page,
    tab === "act",
  );
  const observations = useNursingObservationSearch({ name, category }, page, tab === "observation");
  const list = tab === "act" ? acts : observations;
  const hasNext = list.data ? page * list.data.per < list.data.total : false;
  const level2Options = levels.data?.levels.find((l) => l.code === level1)?.children ?? [];

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(nameInput);
    setPage(1);
  }

  function switchTab(next: Tab) {
    setTab(next);
    setPage(1);
  }

  return (
    <Modal title="看護指示の用語を選択" onClose={onClose} className="modal--lab-order-item">
      {!only && (
      <div className="karte-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "act"}
          className={tab === "act" ? "karte-tabs__tab karte-tabs__tab--active" : "karte-tabs__tab"}
          onClick={() => switchTab("act")}
        >
          看護行為
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "observation"}
          className={
            tab === "observation" ? "karte-tabs__tab karte-tabs__tab--active" : "karte-tabs__tab"
          }
          onClick={() => switchTab("observation")}
        >
          看護観察
        </button>
      </div>
      )}

      <form className="patient-search-form" onSubmit={handleSearch}>
        {tab === "act" ? (
          <>
            <label>
              第1階層
              <select
                value={level1}
                onChange={(e) => {
                  setLevel1(e.target.value);
                  setLevel2("");
                  setPage(1);
                }}
              >
                <option value="">すべて</option>
                {levels.data?.levels.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              第2階層
              <select
                value={level2}
                onChange={(e) => {
                  setLevel2(e.target.value);
                  setPage(1);
                }}
                disabled={!level1}
              >
                <option value="">すべて</option>
                {level2Options.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label>
            分類
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">すべて</option>
              {NURSING_OBSERVATION_CATEGORIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          名称
          <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          {/* 自由記載はマスタに無い指示のための逃げ道。観察を選ぶ用途(水分出納の
              対象項目など)では管理番号が要るので出さない。 */}
          {!only && (
            <button type="button" onClick={() => onSelect(null, "")}>
              自由記載
            </button>
          )}
        </div>
      </form>

      <ErrorBanner error={list.error ?? levels.error} />

      <div className="lab-order-item__table-wrap">
        <table className="master-search__table">
          {tab === "act" ? (
            <>
              <thead>
                <tr>
                  <th>分類</th>
                  <th>行為</th>
                  <th>修飾語</th>
                </tr>
              </thead>
              <tbody>
                {acts.data?.items.map((act) => {
                  // 既定は修飾語なし(D000)。他の修飾語はフォームのセレクトで選び直す。
                  const name = act.level3_name ?? "";
                  const display = [name, act.default_modifier_name].filter(Boolean).join(" ");
                  const disabled = !act.default_code_16;
                  return (
                    <tr
                      key={act.level3_code}
                      className={disabled ? undefined : "master-search__row"}
                      onClick={
                        disabled
                          ? undefined
                          : () =>
                              onSelect(
                                {
                                  kind: "act",
                                  code16: act.default_code_16 as string,
                                  manageNo: act.default_manage_no ?? "",
                                  display,
                                },
                                display,
                              )
                      }
                    >
                      <td>
                        {act.level1_name} / {act.level2_name}
                      </td>
                      <td>{name}</td>
                      <td>
                        {act.modifier_count > 1
                          ? `${act.modifier_count} 種から選択`
                          : (act.default_modifier_name ?? "")}
                      </td>
                    </tr>
                  );
                })}
                {acts.data && acts.data.items.length === 0 && (
                  <tr>
                    <td colSpan={3} className="master-search__empty">
                      該当する用語がありません(マスタ未取込なら看護行為編を取り込んでください)
                    </td>
                  </tr>
                )}
              </tbody>
            </>
          ) : (
            <>
              <thead>
                <tr>
                  <th>観察名称</th>
                  <th>表現</th>
                  <th>単位・結果</th>
                </tr>
              </thead>
              <tbody>
                {observations.data?.items.map((obs) => (
                  <tr
                    key={obs.id}
                    className="master-search__row"
                    onClick={() =>
                      onSelect(
                        { kind: "observation", manageNo: obs.manage_no, display: obs.name },
                        obs.name,
                      )
                    }
                  >
                    <td>{obs.name}</td>
                    <td>{obs.expression_type}</td>
                    <td>{obs.unit || nursingObservationResults(obs).join("、")}</td>
                  </tr>
                ))}
                {observations.data && observations.data.items.length === 0 && (
                  <tr>
                    <td colSpan={3} className="master-search__empty">
                      該当する用語がありません(マスタ未取込なら看護観察編を取り込んでください)
                    </td>
                  </tr>
                )}
              </tbody>
            </>
          )}
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
