import { useEffect, useState, type FormEvent } from "react";
import type { MealCategory, MealCategoryPayload } from "../api/masterClient";
import { useMealCategoryMutations, useMealCategorySearch } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// 食種の種別マスタ。一般食・特別食(治療食)など、食種をまとめる 1 段の分類で、
// 生理検査の PhysioExamTypePage と同じ作り。主食(kind = staple)には付けない。
// 手術の種別(SurgeryCategoryPage)と違い入れ子にはしない。

interface Draft {
  category_code: string;
  name: string;
  name_kana: string;
  valid_from: string;
  valid_to: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  category_code: "",
  name: "",
  name_kana: "",
  valid_from: "",
  valid_to: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): MealCategoryPayload {
  return {
    // 空なら省略してサーバーに自動採番させる。
    category_code: draft.category_code || undefined,
    name: draft.name,
    name_kana: draft.name_kana || null,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function MealCategoryPage() {
  const [name, setName] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MealCategory | "new" | null>(null);

  const list = useMealCategorySearch({ name, active: activeOnly }, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>食種 種別</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            種別を追加
          </button>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          名称・カナ
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="一般食、特別食 など"
          />
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => {
              setActiveOnly(e.target.checked);
              setPage(1);
            }}
          />
          有効な種別のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
        </div>
      </form>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="lab-order-item__compact">コード</th>
            <th>名称</th>
            <th>カナ</th>
            <th className="lab-order-item__compact">有効期間</th>
            <th className="lab-order-item__compact">表示順</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((category) => (
            <tr
              key={category.id}
              onClick={() => setEditing(category)}
              className="master-search__row"
            >
              <td className="lab-order-item__compact">{category.category_code}</td>
              <td>{category.name}</td>
              <td>{category.name_kana}</td>
              <td className="lab-order-item__compact">
                {[category.valid_from, category.valid_to].some(Boolean)
                  ? `${category.valid_from ?? ""} 〜 ${category.valid_to ?? ""}`
                  : ""}
              </td>
              <td className="lab-order-item__compact">{category.display_order}</td>
              <td>{category.note}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={6} className="master-search__empty">
                種別がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

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
        <CategoryEditModal
          category={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface CategoryEditModalProps {
  // null は新規作成。
  category: MealCategory | null;
  onClose: () => void;
}

function CategoryEditModal({ category, onClose }: CategoryEditModalProps) {
  const mutations = useMealCategoryMutations();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (!category) return;
    setDraft({
      category_code: category.category_code,
      name: category.name,
      name_kana: category.name_kana ?? "",
      valid_from: category.valid_from ?? "",
      valid_to: category.valid_to ?? "",
      display_order: category.display_order === null ? "" : String(category.display_order),
      note: category.note ?? "",
    });
  }, [category]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name) return;

    if (category === null) {
      await mutations.create.mutateAsync(toPayload(draft));
    } else {
      await mutations.update.mutateAsync({ id: category.id, payload: toPayload(draft) });
    }
    onClose();
  }

  async function handleDelete() {
    if (category === null) return;
    // 食種は消さず未分類に戻すだけなので、その旨も伝えて確認する。
    if (!window.confirm(`${category.name} を削除しますか？\nこの種別の食種は未分類になります。`)) {
      return;
    }

    await mutations.remove.mutateAsync(category.id);
    onClose();
  }

  return (
    <Modal title={category === null ? "種別を追加" : "種別を編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            種別コード
            <input
              type="text"
              value={draft.category_code}
              onChange={(e) => setDraft({ ...draft, category_code: e.target.value })}
              disabled={category !== null}
              placeholder="空欄で自動採番"
            />
          </label>
          <label>
            名称
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="一般食、特別食 など"
              required
            />
          </label>
          <label>
            カナ名称
            <input
              type="text"
              value={draft.name_kana}
              onChange={(e) => setDraft({ ...draft, name_kana: e.target.value })}
            />
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
            備考
            <input
              type="text"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
        </div>

        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {category !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
