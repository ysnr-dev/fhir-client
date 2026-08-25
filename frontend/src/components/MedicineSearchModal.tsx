import { useId, useMemo, useState } from "react";
import type { Medicine } from "../api/masterClient";
import { useMedicineSearch, useMedicineTypeOptions } from "../api/masterQueries";
import { dosageFormLabel } from "../fhir/medicineHelpers";
import {
  DatasetPickModeTabs,
  DatasetPickTable,
  useDatasetPickMode,
  type DatasetPickProps,
} from "./DatasetPickList";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface MedicineSearchModalProps {
  onSelect: (medicine: Medicine) => void;
  onClose: () => void;
  /** 剤形区分での絞り込み(注射オーダーでは "4"=注射薬)。指定しなければ全剤形。 */
  dosageForm?: string;
  /**
   * 造影剤(と発泡顆粒などの補助剤)だけに絞る。放射線検査の実施入力で使う。
   * 経口造影剤は内用薬なので、剤形では絞れない。
   */
  contrastMedium?: boolean;
  /** モーダルの見出し。用途が造影剤選択のときなどに差し替える。 */
  title?: string;
  /**
   * 一般名処方(【般】〜)への切り替えを出す。院外処方でだけ選べるので、
   * 呼び出し側が入外区分・処方区分を見て渡す。
   */
  allowGeneric?: boolean;
  /**
   * 実施入力データセットに登録された候補から選ぶモード。渡すとモード切替が出て、
   * 候補があるときはそちらから始まる。渡さなければ全件検索だけ。
   */
  datasetPick?: DatasetPickProps;
}

export function MedicineSearchModal({
  onSelect,
  onClose,
  dosageForm,
  contrastMedium,
  title = "医薬品を選択",
  allowGeneric = false,
  datasetPick,
}: MedicineSearchModalProps) {
  const [mode, setMode] = useDatasetPickMode(datasetPick);
  const [name, setName] = useState("");
  // yakkoInput は入力欄の表示文字列、yakkoCode は候補確定時のみ更新する薬効分類番号。
  const [yakkoInput, setYakkoInput] = useState("");
  const [yakkoCode, setYakkoCode] = useState("");
  const [page, setPage] = useState(1);
  // 銘柄 / 一般名の切り替え。一般名は院外処方だけなので既定は銘柄。
  const [generic, setGeneric] = useState(false);
  const { data, error, isFetching } = useMedicineSearch(
    name,
    yakkoCode,
    page,
    true,
    dosageForm,
    contrastMedium,
    generic,
  );
  const yakkoOptions = useMedicineTypeOptions(true);
  const yakkoListId = useId();

  // datalist の表示ラベル("code name") → 薬効分類番号 の対応。code は一意なのでラベルも一意。
  const labelToCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of yakkoOptions.data ?? []) {
      map.set(`${type.code} ${type.name ?? ""}`, type.code);
    }
    return map;
  }, [yakkoOptions.data]);

  function handleNameChange(value: string) {
    setName(value);
    setPage(1);
  }

  function handleGenericChange(next: boolean) {
    setGeneric(next);
    setPage(1);
  }

  function handleYakkoInputChange(value: string) {
    setYakkoInput(value);
    if (value === "") {
      // 空にしたら「すべて」に戻す
      setYakkoCode("");
      setPage(1);
      return;
    }
    // 候補を選択（またはラベル完全一致入力）した時だけ絞り込みを確定する。
    const code = labelToCode.get(value);
    if (code) {
      setYakkoCode(code);
      setPage(1);
    }
  }

  const hasNext = data ? page * data.per < data.total : false;

  return (
    <Modal title={title} onClose={onClose} className="modal--wide">
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
          {allowGeneric && (
            <div className="master-search__mode">
              <span className="master-search__mode-legend">処方名</span>
              <div className="master-search__mode-options">
                <label className="master-search__mode-option">
                  <input
                    type="radio"
                    name="medicine-search-mode"
                    checked={!generic}
                    onChange={() => handleGenericChange(false)}
                  />
                  銘柄
                </label>
                <label className="master-search__mode-option">
                  <input
                    type="radio"
                    name="medicine-search-mode"
                    checked={generic}
                    onChange={() => handleGenericChange(true)}
                  />
                  一般名
                </label>
              </div>
            </div>
          )}
          <div className="master-search__form">
            <label>
              {generic ? "一般名" : "医薬品名"}
              <input
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="部分一致で検索(かな・全半角の違いは無視)"
              />
            </label>
            <label>
              薬効分類
              <input
                type="text"
                value={yakkoInput}
                onChange={(e) => handleYakkoInputChange(e.target.value)}
                list={yakkoListId}
                placeholder="薬効名・番号で絞り込んで選択(例: 冠血管、2171)"
              />
              <datalist id={yakkoListId}>
                {yakkoOptions.data?.map((type) => (
                  <option key={type.id} value={`${type.code} ${type.name ?? ""}`} />
                ))}
              </datalist>
            </label>
          </div>
          <ErrorBanner error={error ?? yakkoOptions.error} />
          <div className="master-search__table-wrap">
            <table className="master-search__table">
              <thead>
                <tr>
                  <th>{generic ? "一般名処方コード" : "医薬品コード"}</th>
                  <th>名称</th>
                  <th>単位</th>
                  <th>剤形</th>
                  <th>薬効分類</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((medicine) => (
                  <tr key={medicine.id}>
                    <td>{medicine.medicine_code}</td>
                    <td>{medicine.name}</td>
                    <td>{medicine.unit_name}</td>
                    <td>{dosageFormLabel(medicine.dosage_form)}</td>
                    <td className="master-search__yakko">
                      {medicine.yakko_name ?? medicine.yakko_code ?? ""}
                    </td>
                    <td className="master-search__actions">
                      {medicine.yj_code && (
                        <a
                          className="master-search__medley-link"
                          href={`https://medley.life/medicines/prescription/${medicine.yj_code}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          DI
                        </a>
                      )}
                      <button type="button" onClick={() => onSelect(medicine)}>
                        選択
                      </button>
                    </td>
                  </tr>
                ))}
                {data && data.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="master-search__empty">
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
        </>
      )}
    </Modal>
  );
}
