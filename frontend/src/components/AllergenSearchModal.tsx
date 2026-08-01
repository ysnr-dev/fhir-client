import { useState } from "react";
import type { JfagyAllergen } from "../api/masterClient";
import { useJfagyAllergenGroups, useJfagyAllergenSearch } from "../api/masterQueries";
import { allergenDomain, allergenDomainLabel, DOMAIN_LABELS } from "../fhir/allergyHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface AllergenSearchModalProps {
  onSelect: (allergen: JfagyAllergen) => void;
  onClose: () => void;
}

// 分類セレクトの値。1文字は領域(F/M/N)、4文字は階層プレフィックス(例: J9FA=農産食品)。
function filtersFromSelection(selection: string, mainOnly: boolean) {
  return {
    domain: selection.length === 1 ? selection : undefined,
    codePrefix: selection.length > 1 ? selection : undefined,
    mainOnly,
  };
}

// J-FAGY コードの先頭4桁が属する群(レベル2)を表す。
function groupPrefix(jfagyCode: string): string {
  return jfagyCode.slice(0, 4);
}

export function AllergenSearchModal({ onSelect, onClose }: AllergenSearchModalProps) {
  const [name, setName] = useState("");
  const [selection, setSelection] = useState("");
  // 既定では主要品目(MAINFLAG=1)に絞り、代表的なアレルゲンから選べるようにする。
  const [mainOnly, setMainOnly] = useState(true);
  const [page, setPage] = useState(1);

  const groups = useJfagyAllergenGroups(true);
  const { data, error, isFetching } = useJfagyAllergenSearch(
    name,
    filtersFromSelection(selection, mainOnly),
    page,
    true,
  );

  function handleNameChange(value: string) {
    setName(value);
    setPage(1);
  }

  function handleSelectionChange(value: string) {
    setSelection(value);
    setPage(1);
  }

  function handleMainOnlyChange(value: boolean) {
    setMainOnly(value);
    setPage(1);
  }

  const groupItems = groups.data?.items ?? [];
  const foodGroups = groupItems.filter((g) => allergenDomain(g.jfagy_code) === "F");
  const nonFoodGroups = groupItems.filter((g) => allergenDomain(g.jfagy_code) === "N");
  // 検索結果の「分類」列に群の名称(農産食品など)を表示するための対応表。
  const groupNames = new Map(groupItems.map((g) => [groupPrefix(g.jfagy_code), g.name]));

  const hasNext = data ? page * data.per < data.total : false;
  const emptyByMainOnly = mainOnly && data?.items.length === 0;

  return (
    <Modal title="アレルゲンを選択" onClose={onClose} className="modal--wide">
      <div className="master-search__form">
        <div className="master-search__filters">
          <label>
            アレルゲン名
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="部分一致で検索(かな・全半角の違いも吸収)"
            />
          </label>
          <label>
            分類
            <select value={selection} onChange={(e) => handleSelectionChange(e.target.value)}>
              <option value="">すべて</option>
              <optgroup label={DOMAIN_LABELS.F}>
                <option value="F">食品(すべて)</option>
                {foodGroups.map((g) => (
                  <option key={g.jfagy_code} value={groupPrefix(g.jfagy_code)}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={DOMAIN_LABELS.N}>
                <option value="N">非食品・非医薬品(すべて)</option>
                {nonFoodGroups.map((g) => (
                  <option key={g.jfagy_code} value={groupPrefix(g.jfagy_code)}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={DOMAIN_LABELS.M}>
                <option value="M">医薬品(すべて)</option>
              </optgroup>
            </select>
          </label>
        </div>
        <label className="master-search__checkbox">
          <input
            type="checkbox"
            checked={mainOnly}
            onChange={(e) => handleMainOnlyChange(e.target.checked)}
          />
          主要な品目のみ表示
        </label>
        {emptyByMainOnly && (
          <p className="master-search__preset-hint">
            主要な品目に絞り込み中です。見つからない場合はチェックを外して全品目から検索してください。
          </p>
        )}
      </div>
      <ErrorBanner error={error ?? groups.error} />
      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>分類</th>
              <th>名称</th>
              <th>カナ</th>
              <th>英名</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((allergen) => (
              <tr key={allergen.id}>
                <td>
                  {groupNames.get(groupPrefix(allergen.jfagy_code)) ??
                    allergenDomainLabel(allergen.jfagy_code)}
                </td>
                <td>
                  {allergen.name}
                  {allergen.main_flag === "1" && (
                    <span className="master-search__badge" title="主要品目">
                      ★
                    </span>
                  )}
                </td>
                <td>{allergen.name_kana}</td>
                <td>{allergen.name_en}</td>
                <td className="master-search__actions">
                  <button type="button" onClick={() => onSelect(allergen)}>
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="master-search__empty">
                  該当するアレルゲンがありません
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
