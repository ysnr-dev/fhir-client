import { useEffect, useState, type FormEvent } from "react";
import type { MealDiet, MealDietPayload } from "../api/masterClient";
import {
  useMealCategoryOptions,
  useMealDiet,
  useMealDietMutations,
  useMealDietSearch,
  type MealDietFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import {
  MEAL_NUTRIENT_COLUMNS,
  formatMealNutrient,
  type MealNutrientKey,
} from "../components/mealItemOptions";

// 食種マスタ。食事オーダー項目(MealItemPage: 主食・副食形態)と同じ最小の作りに、
// 食種だけが持つ種別・食止め・主成分量・適応を足したもの(docs/meal-order-design.md §3)。

// 編集フォームの値。input で扱うため全て文字列で持ち、保存時に payload へ変換する。
interface Draft {
  item_code: string;
  name: string;
  name_kana: string;
  // 食止め(禁食)の食種か。
  is_fasting: boolean;
  // 種別(master_meal_categories)。
  category_code: string;
  // 主成分量(1 日あたりの標準値)。空欄は未登録。
  nutrients: Record<MealNutrientKey, string>;
  // 適応・備考。オーダー画面の食種選択で医師に見せる文。
  indication: string;
  valid_from: string;
  valid_to: string;
  display_order: string;
  note: string;
}

function emptyNutrients(): Record<MealNutrientKey, string> {
  return {
    energy_kcal: "",
    protein_g: "",
    fat_g: "",
    carbohydrate_g: "",
    water_ml: "",
    salt_g: "",
  };
}

const emptyDraft: Draft = {
  item_code: "",
  name: "",
  name_kana: "",
  is_fasting: false,
  category_code: "",
  nutrients: emptyNutrients(),
  indication: "",
  valid_from: "",
  valid_to: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): MealDietPayload {
  const nutrients = Object.fromEntries(
    MEAL_NUTRIENT_COLUMNS.map((c) => [
      c.key,
      draft.nutrients[c.key].trim() === "" ? null : Number(draft.nutrients[c.key]),
    ]),
  ) as Record<MealNutrientKey, number | null>;
  return {
    item_code: draft.item_code,
    name: draft.name,
    name_kana: draft.name_kana || null,
    is_fasting: draft.is_fasting,
    category_code: draft.category_code || null,
    ...nutrients,
    indication: draft.indication || null,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function MealDietPage() {
  const [inputs, setInputs] = useState<MealDietFilters>({});
  const [filters, setFilters] = useState<MealDietFilters>({});
  const [page, setPage] = useState(1);
  // 編集対象の id。"new" は新規作成モーダル。
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const list = useMealDietSearch(filters, page);
  // 種別は一覧の名称表示と絞り込みの両方で使う。数件なので全件引く。
  const categories = useMealCategoryOptions();
  const categoryItems = categories.data?.items ?? [];

  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>食種マスタ</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            食種を追加
          </button>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          名称・カナ
          <input
            type="text"
            value={inputs.name ?? ""}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
          />
        </label>
        <label>
          種別
          <select
            value={inputs.categoryCode ?? ""}
            onChange={(e) => setInputs({ ...inputs, categoryCode: e.target.value })}
          >
            <option value="">すべて</option>
            {categoryItems.map((category) => (
              <option key={category.category_code} value={category.category_code}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={inputs.active ?? false}
            onChange={(e) => setInputs({ ...inputs, active: e.target.checked })}
          />
          有効期間内のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setInputs({});
              setFilters({});
              setPage(1);
            }}
          >
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={list.error ?? categories.error} />

      <div className="master-search__table-wrap master-search__table-wrap--auto">
        <table className="master-search__table meal-diet-table">
          <thead>
            <tr>
              <th>コード</th>
              <th>名称</th>
              <th className="rad-item__compact">種別</th>
              {/* 主成分量は 1 日あたりの標準値。列見出しに単位を出す。 */}
              {MEAL_NUTRIENT_COLUMNS.map((c) => (
                <th key={c.key} className="meal-diet-table__num">
                  {c.label}
                  <small>({c.unit})</small>
                </th>
              ))}
              <th>適応・備考</th>
              <th className="rad-item__compact">有効期間</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((diet) => (
              <tr key={diet.id} onClick={() => setEditing(diet.id)} className="master-search__row">
                <td>{diet.item_code}</td>
                <td>
                  {diet.name}
                  {/* 食止めは「その日は食事を出さない」特別な食種なので印を出す。 */}
                  {diet.is_fasting && <span className="dose-conversion__badge">食止め</span>}
                </td>
                <td className="rad-item__compact">
                  {diet.category_code
                    ? (categoryItems.find((c) => c.category_code === diet.category_code)?.name ??
                      diet.category_code)
                    : ""}
                </td>
                {MEAL_NUTRIENT_COLUMNS.map((c) => (
                  <td key={c.key} className="meal-diet-table__num">
                    {formatMealNutrient(diet[c.key])}
                  </td>
                ))}
                <td className="meal-diet-table__indication" title={diet.indication ?? undefined}>
                  {diet.indication}
                </td>
                <td className="rad-item__compact">
                  {(diet.valid_from || diet.valid_to) &&
                    `${diet.valid_from ?? ""}〜${diet.valid_to ?? ""}`}
                </td>
              </tr>
            ))}
            {list.data && list.data.items.length === 0 && (
              <tr>
                <td colSpan={5 + MEAL_NUTRIENT_COLUMNS.length} className="master-search__empty">
                  食種がありません
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

      {editing !== null && (
        <DietEditModal
          dietId={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface DietEditModalProps {
  // null は新規作成。
  dietId: number | null;
  onClose: () => void;
}

function DietEditModal({ dietId, onClose }: DietEditModalProps) {
  const detail = useMealDiet(dietId);
  const mutations = useMealDietMutations();
  const categories = useMealCategoryOptions();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (!detail.data) return;
    const d: MealDiet = detail.data;
    const nutrients = emptyNutrients();
    for (const c of MEAL_NUTRIENT_COLUMNS) nutrients[c.key] = formatMealNutrient(d[c.key]);
    setDraft({
      item_code: d.item_code,
      name: d.name,
      name_kana: d.name_kana ?? "",
      is_fasting: d.is_fasting,
      category_code: d.category_code ?? "",
      nutrients,
      indication: d.indication ?? "",
      valid_from: d.valid_from ?? "",
      valid_to: d.valid_to ?? "",
      display_order: d.display_order === null ? "" : String(d.display_order),
      note: d.note ?? "",
    });
  }, [detail.data]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name) return;

    const payload = toPayload(draft);
    if (dietId === null) {
      await mutations.create.mutateAsync(payload);
      onClose();
    } else {
      await mutations.update.mutateAsync({ id: dietId, payload });
    }
  }

  async function handleDelete() {
    if (dietId === null || !detail.data) return;
    if (!window.confirm(`${detail.data.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(dietId);
    onClose();
  }

  const saving = mutations.create.isPending || mutations.update.isPending;

  return (
    <Modal
      title={dietId === null ? "食種を追加" : "食種を編集"}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            食種コード
            <input
              type="text"
              value={draft.item_code}
              onChange={(e) => setDraft({ ...draft, item_code: e.target.value })}
              placeholder={dietId === null ? "空欄なら自動採番" : undefined}
              disabled={dietId !== null}
            />
          </label>
          <label>
            名称
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            カナ(検索用)
            <input
              type="text"
              value={draft.name_kana}
              onChange={(e) => setDraft({ ...draft, name_kana: e.target.value })}
            />
          </label>
          <label>
            種別
            <select
              value={draft.category_code}
              onChange={(e) => setDraft({ ...draft, category_code: e.target.value })}
            >
              <option value="">未分類</option>
              {(categories.data?.items ?? []).map((category) => (
                <option key={category.category_code} value={category.category_code}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            有効開始日
            <input
              type="date"
              value={draft.valid_from}
              onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })}
            />
          </label>
          <label>
            有効終了日
            <input
              type="date"
              value={draft.valid_to}
              onChange={(e) => setDraft({ ...draft, valid_to: e.target.value })}
            />
          </label>
          <label>
            表示順
            <input
              type="number"
              value={draft.display_order}
              onChange={(e) => setDraft({ ...draft, display_order: e.target.value })}
            />
          </label>
          <label>
            備考(管理用)
            <input
              type="text"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
        </div>

        {/* 主成分量は 1 日あたり(朝昼夕の合計)の標準値。全て任意で、食止めは空のまま。
            合計整合(蛋白 4 + 脂質 9 + 糖質 4 ≒ 熱量)は端数と食物繊維でずれるので検証しない。 */}
        <fieldset className="meal-diet-nutrients">
          <legend>主成分量(1 日あたり)</legend>
          {MEAL_NUTRIENT_COLUMNS.map((c) => (
            <label key={c.key}>
              {c.label}({c.unit})
              <input
                type="number"
                min="0"
                step="0.1"
                value={draft.nutrients[c.key]}
                onChange={(e) =>
                  setDraft({ ...draft, nutrients: { ...draft.nutrients, [c.key]: e.target.value } })
                }
              />
            </label>
          ))}
        </fieldset>

        {/* オーダー画面の食種選択で医師に見せる文。管理用の備考とは分ける。 */}
        <label className="meal-diet-indication">
          適応・備考(オーダー画面に表示)
          <textarea
            value={draft.indication}
            onChange={(e) => setDraft({ ...draft, indication: e.target.value })}
            rows={2}
            placeholder="糖尿病・耐糖能異常。腎症合併例は腎臓食を選ぶ など"
          />
        </label>

        {/* 食止めは主食を伴わないので、オーダー画面ではこの印の付いた食種を
            選んだときに主食欄を無効にする。 */}
        <label className="dose-conversion__checkbox meal-diet-fasting">
          <input
            type="checkbox"
            checked={draft.is_fasting}
            onChange={(e) => setDraft({ ...draft, is_fasting: e.target.checked })}
          />
          食止め(禁食)の食種
        </label>

        <ErrorBanner error={detail.error} />
        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={saving}>
            保存
          </button>
          {dietId !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
