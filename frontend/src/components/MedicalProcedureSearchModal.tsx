import { useState, type FormEvent } from "react";
import type { MedicalProcedure } from "../api/masterClient";
import { useMedicalProcedureSearch } from "../api/masterQueries";
import {
  DatasetPickModeTabs,
  DatasetPickTable,
  useDatasetPickMode,
  type DatasetPickProps,
} from "./DatasetPickList";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// レセプト電算の医科診療行為マスタから 1 件選ぶ。放射線検査の実施入力用データセットに
// 手技料を積むときと、実施入力で手技を足すときに使う。
//
// 既定は点数表の章 E(画像診断)に絞る。全 9 万件から名称だけで引くと造影剤注入手技の
// ような目的の手技に辿り着けないため。造影剤注入手技(E003)は E に入っている。
// 章が変わる領域(処置は J)は defaultSection で渡す。

// コード表用番号のアルファベット部 = 点数表の章。実施入力で使う範囲だけ並べる。
const SECTIONS: { code: string; label: string }[] = [
  { code: "E", label: "E 画像診断" },
  { code: "D", label: "D 検査" },
  { code: "G", label: "G 注射" },
  { code: "J", label: "J 処置" },
  { code: "", label: "すべての章" },
];

interface Props {
  onSelect: (procedure: MedicalProcedure) => void;
  onClose: () => void;
  /**
   * 実施入力データセットに登録された候補から選ぶモード。渡すとモード切替が出て、
   * 候補があるときはそちらから始まる。渡さなければ全件検索だけ。
   */
  datasetPick?: DatasetPickProps;
  /** 最初に選んでおく点数表の章。省略時は E(画像診断)。 */
  defaultSection?: string;
}

export function MedicalProcedureSearchModal({
  onSelect,
  onClose,
  defaultSection = "E",
  datasetPick,
}: Props) {
  const [mode, setMode] = useDatasetPickMode(datasetPick);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [section, setSection] = useState(defaultSection);
  const [page, setPage] = useState(1);

  const list = useMedicalProcedureSearch(
    { name, codeTableNumberAlpha: section },
    page,
    name.trim().length > 0,
  );
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(input);
    setPage(1);
  }

  return (
    <Modal title="診療行為(手技料)を検索" onClose={onClose} className="modal--lab-order-item">
      {datasetPick && (
        <DatasetPickModeTabs
          mode={mode}
          onChange={setMode}
          count={datasetPick.options.length}
        />
      )}
      {datasetPick && mode === "dataset" ? (
        <DatasetPickTable {...datasetPick} />
      ) : (
        <>
          <form className="patient-search-form" onSubmit={handleSearch}>
            <label>
              名称・カナ
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="ＣＴ撮影、造影剤注入手技 など"
              />
            </label>
            <label>
              点数表の章
              <select
                value={section}
                onChange={(e) => {
                  setSection(e.target.value);
                  setPage(1);
                }}
              >
                {SECTIONS.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="patient-search-form__actions">
              <button type="submit">検索</button>
            </div>
          </form>

          <ErrorBanner error={list.error} />

          {name.trim().length === 0 ? (
            <p className="order-select__muted">名称で検索してください</p>
          ) : (
            <>
              <div className="lab-order-item__table-wrap">
                <table className="master-search__table">
                  <thead>
                    <tr>
                      <th>コード</th>
                      <th>名称</th>
                      <th className="rad-item__compact">点数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data?.items.map((procedure) => (
                      <tr
                        key={procedure.id}
                        className="master-search__row"
                        onClick={() => onSelect(procedure)}
                      >
                        <td>{procedure.procedure_code}</td>
                        <td>{procedure.name}</td>
                        <td className="rad-item__compact">
                          {procedure.points ? `${Number(procedure.points).toLocaleString()} 点` : ""}
                        </td>
                      </tr>
                    ))}
                    {list.data && list.data.items.length === 0 && (
                      <tr>
                        <td colSpan={3} className="master-search__empty">
                          該当する診療行為がありません
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
        </>
      )}
    </Modal>
  );
}
