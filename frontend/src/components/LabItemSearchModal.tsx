import { useState, type ReactNode } from "react";
import type { LabItem, LabItemDrilldown } from "../api/masterClient";
import { useLabItemFilterOptions, useLabItemSearch } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface LabItemSearchModalProps {
  onSelect: (item: LabItem) => void;
  onClose: () => void;
}

interface DrilldownListProps {
  title: string;
  values: string[] | undefined;
  selected: string;
  onSelect: (value: string) => void;
  // リスト見出しに置く付随 UI(大項目リストの名称検索ボックス)。
  children?: ReactNode;
}

// 段階的絞り込みの1リスト。先頭の「すべて」でその段の絞り込みを解除する。
function DrilldownList({ title, values, selected, onSelect, children }: DrilldownListProps) {
  return (
    <div className="lab-drilldown__col">
      <div className="lab-drilldown__head">
        <span className="lab-drilldown__title">{title}</span>
        {children}
      </div>
      <ul className="lab-drilldown__list">
        <li>
          <button
            type="button"
            className={selected === "" ? "is-selected" : undefined}
            onClick={() => onSelect("")}
          >
            すべて
          </button>
        </li>
        {values?.map((value) => (
          <li key={value}>
            <button
              type="button"
              className={value === selected ? "is-selected" : undefined}
              onClick={() => onSelect(value)}
            >
              {value}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LabItemSearchModal({ onSelect, onClose }: LabItemSearchModalProps) {
  const [name, setName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [majorItem, setMajorItem] = useState("");
  const [specimen, setSpecimen] = useState("");
  const [method, setMethod] = useState("");
  const [page, setPage] = useState(1);

  const drilldown: LabItemDrilldown = {
    category_name: categoryName || undefined,
    major_item: majorItem || undefined,
    jlac11_specimen: specimen || undefined,
    jlac11_method: method || undefined,
  };

  // 測定法は結果一覧を絞るだけで、その下位のリストが無いので選択肢の取得には要らない。
  const options = useLabItemFilterOptions(
    {
      name: name || undefined,
      category_name: categoryName || undefined,
      major_item: majorItem || undefined,
      jlac11_specimen: specimen || undefined,
    },
    true,
  );
  const { data, error, isFetching } = useLabItemSearch(drilldown, page, true);

  // 上位の絞り込みが変わると下位の選択は選択肢から消えうるので必ず解除する。
  // 名称検索も同じ扱い(大項目リストの中身が入れ替わるため)。
  function handleNameChange(value: string) {
    setName(value);
    setMajorItem("");
    setSpecimen("");
    setMethod("");
    setPage(1);
  }

  function handleCategoryChange(value: string) {
    setCategoryName(value);
    setMajorItem("");
    setSpecimen("");
    setMethod("");
    setPage(1);
  }

  function handleMajorItemChange(value: string) {
    setMajorItem(value);
    setSpecimen("");
    setMethod("");
    setPage(1);
  }

  function handleSpecimenChange(value: string) {
    setSpecimen(value);
    setMethod("");
    setPage(1);
  }

  function handleMethodChange(value: string) {
    setMethod(value);
    setPage(1);
  }

  const hasNext = data ? page * data.per < data.total : false;

  return (
    <Modal title="検査項目を選択" onClose={onClose} className="modal--lab-item">
      <div className="master-search__form">
        <label className="lab-drilldown__category">
          区分名称
          <select value={categoryName} onChange={(e) => handleCategoryChange(e.target.value)}>
            <option value="">すべて</option>
            {options.data?.category_names.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorBanner error={error ?? options.error} />
      <div className="lab-drilldown">
        <DrilldownList
          title="大項目"
          values={options.data?.major_items}
          selected={majorItem}
          onSelect={handleMajorItemChange}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="名称・略称で絞り込み"
          />
        </DrilldownList>
        <DrilldownList
          title="材料"
          values={options.data?.specimens}
          selected={specimen}
          onSelect={handleSpecimenChange}
        />
        <DrilldownList
          title="測定法"
          values={options.data?.methods}
          selected={method}
          onSelect={handleMethodChange}
        />
      </div>
      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>大項目</th>
              <th>検査項目名称</th>
              <th>材料</th>
              <th>測定法</th>
              <th>単位</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr key={item.id}>
                <td>{item.major_item}</td>
                <td>{item.fhir_item_name}</td>
                <td>{item.jlac11_specimen}</td>
                <td>{item.jlac11_method}</td>
                <td>{item.display_unit}</td>
                <td className="master-search__actions">
                  <button type="button" onClick={() => onSelect(item)}>
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="master-search__empty">
                  該当する検査項目がありません
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
