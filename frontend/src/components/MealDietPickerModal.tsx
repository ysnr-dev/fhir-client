import { Fragment, useMemo, useState } from "react";
import type { MealCategory, MealDiet } from "../api/masterClient";
import { toKatakana } from "../lib/kana";
import { ErrorBanner } from "./ErrorBanner";
import { MEAL_NUTRIENT_COLUMNS, formatMealNutrient } from "./mealItemOptions";
import { Modal } from "./Modal";

interface Props {
  /** 有効期間内の全食種(useMealDietOptions)。呼び出し元が既に持っているので受け取る。 */
  diets: MealDiet[];
  categories: MealCategory[];
  error?: unknown;
  /** いま選ばれている食種コード。行を強調する。 */
  selectedCode?: string | null;
  onSelect: (diet: MealDiet) => void;
  onClose: () => void;
}

interface DietGroup {
  key: string;
  label: string;
  diets: MealDiet[];
}

/**
 * 名称・カナ・コードの部分一致。マスタは全件クライアントにあるので API は叩かない。
 * ひらがなで打ってもカナ名称に当たるよう、両側をカタカナに寄せて比べる。
 */
function matches(diet: MealDiet, query: string): boolean {
  if (!query) return true;
  const q = toKatakana(query).toLowerCase();
  return [diet.name, diet.name_kana ?? "", diet.item_code].some((text) =>
    toKatakana(text).toLowerCase().includes(q),
  );
}

// 食事オーダー画面の食種選択。食種は施設で 100〜300 件になり、主成分量を横に並べて
// 「比べて選ぶ」ものなので、セレクトではなく表にしている(docs/meal-order-design.md §3.3)。
// 種別ごとに見出しを入れ、食止めは末尾にまとめる。
export function MealDietPickerModal({
  diets,
  categories,
  error,
  selectedCode,
  onSelect,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  // 種別の絞り込み。"" は全て、"fasting" は食止めだけ、"other" は未分類。
  const [categoryFilter, setCategoryFilter] = useState("");

  const groups = useMemo<DietGroup[]>(() => {
    const filtered = diets.filter((d) => matches(d, query.trim()));
    const classified = new Set(categories.map((c) => c.category_code));
    const result: DietGroup[] = categories.map((category) => ({
      key: category.category_code,
      label: category.name,
      diets: filtered.filter(
        (d) => !d.is_fasting && d.category_code === category.category_code,
      ),
    }));
    // 種別が付いていない食種(消した種別を指したままの食種も含む)。
    result.push({
      key: "other",
      label: "その他",
      diets: filtered.filter(
        (d) => !d.is_fasting && (!d.category_code || !classified.has(d.category_code)),
      ),
    });
    // 食止めは種別に関わらず末尾に。
    result.push({ key: "fasting", label: "食止め", diets: filtered.filter((d) => d.is_fasting) });
    return result.filter(
      (g) => g.diets.length > 0 && (categoryFilter === "" || g.key === categoryFilter),
    );
  }, [diets, categories, query, categoryFilter]);

  const columnCount = 2 + MEAL_NUTRIENT_COLUMNS.length + 1;

  return (
    <Modal title="食種選択" onClose={onClose} className="modal--lab-order-item">
      <div className="patient-search-form">
        <label>
          名称・カナ
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="絞り込み"
            autoFocus
          />
        </label>
        <label>
          種別
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">すべて</option>
            {categories.map((c) => (
              <option key={c.category_code} value={c.category_code}>
                {c.name}
              </option>
            ))}
            <option value="other">その他</option>
            <option value="fasting">食止め</option>
          </select>
        </label>
      </div>

      <ErrorBanner error={error} />

      <div className="master-search__table-wrap meal-diet-picker__table-wrap">
        <table className="master-search__table meal-diet-table">
          <thead>
            <tr>
              <th>コード</th>
              <th>名称</th>
              {MEAL_NUTRIENT_COLUMNS.map((c) => (
                <th key={c.key} className="meal-diet-table__num">
                  {c.label}
                  <small>({c.unit})</small>
                </th>
              ))}
              <th>適応・備考</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                {/* 種別の見出し行(セレクトの optgroup にあたる)。 */}
                <tr className="meal-diet-picker__group">
                  <th colSpan={columnCount}>{group.label}</th>
                </tr>
                {group.diets.map((diet) => (
                  <tr
                    key={diet.id}
                    className={
                      diet.item_code === selectedCode
                        ? "master-search__row meal-diet-picker__row--selected"
                        : "master-search__row"
                    }
                    onClick={() => onSelect(diet)}
                  >
                    <td>{diet.item_code}</td>
                    <td>{diet.name}</td>
                    {MEAL_NUTRIENT_COLUMNS.map((c) => (
                      <td key={c.key} className="meal-diet-table__num">
                        {formatMealNutrient(diet[c.key]) || "—"}
                      </td>
                    ))}
                    <td className="meal-diet-table__indication" title={diet.indication ?? undefined}>
                      {diet.indication}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="master-search__empty">
                  該当する食種がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
