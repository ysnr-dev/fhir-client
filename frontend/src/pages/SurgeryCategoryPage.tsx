import { useEffect, useState, type FormEvent } from "react";
import type { SurgeryCategory, SurgeryCategoryPayload } from "../api/masterClient";
import { useSurgeryCategoryMutations, useSurgeryCategorySearch } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import {
  buildSurgeryCategoryTree,
  surgeryCategoryPathName,
  surgeryCategorySubtreeCodes,
} from "../components/surgeryCategoryOptions";

// 術式の種別(分類)マスタ。生理検査の PhysioExamTypePage に当たるが、分類が
// 入れ子になる(医科点数表 第2章第10部 手術 第1節の「款 → 区分」)ので、一覧は
// ページングせず木の順に並べ、編集画面に親分類の欄を持つ。
// 点数表の款・区分は seed で入っているので、施設は必要なところだけ足し引きする。

interface Draft {
  category_code: string;
  name: string;
  name_kana: string;
  parent_code: string;
  valid_from: string;
  valid_to: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  category_code: "",
  name: "",
  name_kana: "",
  parent_code: "",
  valid_from: "",
  valid_to: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): SurgeryCategoryPayload {
  return {
    // 空なら省略してサーバーに自動採番させる(親のコードに2桁を足したもの)。
    category_code: draft.category_code || undefined,
    name: draft.name,
    name_kana: draft.name_kana || null,
    parent_code: draft.parent_code || null,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function SurgeryCategoryPage() {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [editing, setEditing] = useState<SurgeryCategory | "new" | null>(null);

  // 木に組み立てるので全件をまとめて引く(ページングしない)。
  const list = useSurgeryCategorySearch({ name: query, active: activeOnly });
  const all = list.data?.items ?? [];
  const rows = buildSurgeryCategoryTree(all);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setQuery(name);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>術式 種別</h1>
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
            placeholder="腹部、胃 など"
          />
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          有効な種別のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setName("");
              setQuery("");
            }}
          >
            クリア
          </button>
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
          {rows.map(({ category, depth }) => (
            <tr
              key={category.id}
              onClick={() => setEditing(category)}
              className="master-search__row"
            >
              <td className="lab-order-item__compact">{category.category_code}</td>
              {/* 段の深さは字下げで表す。検索で親が外れた分類は最上位に並ぶので、
                  どこにぶら下がっているか分かるよう親の名称も添える。 */}
              <td>
                {"　".repeat(depth)}
                {category.name}
                {depth === 0 && category.parent_code && (
                  <span className="master-search__parent-hint">
                    （{surgeryCategoryPathName(all, category.parent_code) || category.parent_code} の下）
                  </span>
                )}
              </td>
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
          {list.data && rows.length === 0 && (
            <tr>
              <td colSpan={6} className="master-search__empty">
                種別がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <CategoryEditModal
          category={editing === "new" ? null : editing}
          categories={all}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface CategoryEditModalProps {
  // null は新規作成。
  category: SurgeryCategory | null;
  categories: SurgeryCategory[];
  onClose: () => void;
}

function CategoryEditModal({ category, categories, onClose }: CategoryEditModalProps) {
  const mutations = useSurgeryCategoryMutations();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (!category) return;
    setDraft({
      category_code: category.category_code,
      name: category.name,
      name_kana: category.name_kana ?? "",
      parent_code: category.parent_code ?? "",
      valid_from: category.valid_from ?? "",
      valid_to: category.valid_to ?? "",
      display_order: category.display_order === null ? "" : String(category.display_order),
      note: category.note ?? "",
    });
  }, [category]);

  // 自分自身と配下は親にできない(輪になる)ので選択肢から外す。
  const excluded = category ? surgeryCategorySubtreeCodes(categories, category.category_code) : new Set<string>();
  const parentOptions = buildSurgeryCategoryTree(categories).filter(
    ({ category: c }) => !excluded.has(c.category_code),
  );

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
    // 術式は消さず未分類に戻すだけなので、その旨も伝えて確認する。
    if (!window.confirm(`${category.name} を削除しますか？\nこの種別の術式は未分類になります。`)) {
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
            親の種別
            <select
              value={draft.parent_code}
              onChange={(e) => setDraft({ ...draft, parent_code: e.target.value })}
            >
              <option value="">なし（最上位）</option>
              {parentOptions.map(({ category: c, depth }) => (
                <option key={c.category_code} value={c.category_code}>
                  {"　".repeat(depth)}
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            名称
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="腹部、胃、食道、腸、他 など"
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
