import { useEffect, useState, type FormEvent } from "react";
import type { SchemaCategory, SchemaSummary } from "../api/masterClient";
import {
  useSchemaCategories,
  useSchemaCategoryMutations,
  useSchemaMutations,
  useSchemas,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import {
  buildCategoryTree,
  flattenForSelect,
  siblingsOf,
  type CategoryNode,
} from "../components/schemaCategoryTree";
import { makeThumbnailDataUrl, normalizeImageFile } from "../fhir/schemaImage";

// シェーママスタ。左ペインでカテゴリ(任意の深さの階層)を管理し、
// 右ペインで選択カテゴリ直下のシェーマ(台紙画像)を管理する。

// 選択中カテゴリ。null は「未分類」(category_id が空のシェーマ)。
type Selection = number | null;

export function SchemaMasterPage() {
  const categoriesQuery = useSchemaCategories();
  const [selected, setSelected] = useState<Selection>(null);
  // 折りたたみ中のカテゴリ id(既定は全て展開)。
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // カテゴリ編集モーダル: "new" は新規(parentId 付き)、それ以外は編集。
  const [categoryEditing, setCategoryEditing] = useState<
    { mode: "new"; parentId: number | null } | { mode: "edit"; category: SchemaCategory } | null
  >(null);
  const [schemaEditing, setSchemaEditing] = useState<SchemaSummary | "new" | null>(null);

  // categoryItems は React Query が返す参照で、データが変わるまで安定している
  // (毎レンダー作り直す配列を effect の依存にしない)。
  const categoryItems = categoriesQuery.data?.items;
  const categories = categoryItems ?? [];
  const tree = buildCategoryTree(categories);
  const categoryMutations = useSchemaCategoryMutations();

  // 選択中カテゴリが削除されたら未分類へ戻す。
  useEffect(() => {
    if (selected !== null && categoryItems && !categoryItems.some((c) => c.id === selected)) {
      setSelected(null);
    }
  }, [categoryItems, selected]);

  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 同じ親の兄弟内で隣と入れ替え、変わった行だけ 1 始まりの連番へ振り直す
  // (QuestionnaireCategoryModal と同じ割り切り)。
  function moveCategory(category: SchemaCategory, direction: -1 | 1) {
    const siblings = siblingsOf(categories, category.parent_id);
    const index = siblings.findIndex((c) => c.id === category.id);
    const target = siblings[index + direction];
    if (!target) return;
    siblings[index + direction] = siblings[index];
    siblings[index] = target;

    siblings.forEach((sibling, position) => {
      const display_order = position + 1;
      if (sibling.display_order === display_order) return;
      categoryMutations.update.mutate({ id: sibling.id, payload: { display_order } });
    });
  }

  function deleteCategory(category: SchemaCategory) {
    if (!window.confirm(`カテゴリ「${category.name}」を削除しますか？`)) return;
    categoryMutations.remove.mutate(category.id);
  }

  const busy =
    categoryMutations.create.isPending ||
    categoryMutations.update.isPending ||
    categoryMutations.remove.isPending;

  function renderNode(node: CategoryNode, depth: number) {
    const { category, children } = node;
    const siblings = siblingsOf(categories, category.parent_id);
    const index = siblings.findIndex((c) => c.id === category.id);
    const isCollapsed = collapsed.has(category.id);

    return (
      <li key={category.id}>
        <div
          className={`schema-master__cat-row${selected === category.id ? " is-selected" : ""}`}
          style={{ paddingLeft: `${depth * 16}px` }}
        >
          <button
            type="button"
            className="schema-master__cat-toggle"
            aria-label={isCollapsed ? `${category.name} を展開` : `${category.name} を折りたたむ`}
            style={{ visibility: children.length > 0 ? "visible" : "hidden" }}
            onClick={() => toggleCollapse(category.id)}
          >
            {isCollapsed ? "▶" : "▼"}
          </button>
          <button
            type="button"
            className="schema-master__cat-name"
            onClick={() => setSelected(category.id)}
          >
            {category.name}
          </button>
          <span className="schema-master__cat-actions">
            <button
              type="button"
              aria-label={`${category.name} を上へ`}
              disabled={index <= 0 || busy}
              onClick={() => moveCategory(category, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`${category.name} を下へ`}
              disabled={index === siblings.length - 1 || busy}
              onClick={() => moveCategory(category, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              title="子カテゴリを追加"
              disabled={busy}
              onClick={() => setCategoryEditing({ mode: "new", parentId: category.id })}
            >
              +子
            </button>
            <button
              type="button"
              title="カテゴリを編集"
              disabled={busy}
              onClick={() => setCategoryEditing({ mode: "edit", category })}
            >
              編集
            </button>
            <button
              type="button"
              title="カテゴリを削除"
              disabled={busy}
              onClick={() => deleteCategory(category)}
            >
              削除
            </button>
          </span>
        </div>
        {!isCollapsed && children.length > 0 && (
          <ul className="schema-master__cat-children">
            {children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>シェーママスタ</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setSchemaEditing("new")}>
            シェーマを追加
          </button>
        </div>
      </div>

      <p className="dose-conversion__lead">
        診療記録に描き込んで挿入する台紙画像です。カテゴリは任意の深さの階層で分類でき、
        並び順は診療記録の「シェーマ」選択画面の表示順になります。
      </p>

      <ErrorBanner error={categoriesQuery.error} />
      <ErrorBanner
        error={
          categoryMutations.create.error ??
          categoryMutations.update.error ??
          categoryMutations.remove.error
        }
      />

      <div className="schema-master">
        <div className="schema-master__categories">
          <div className="schema-master__pane-header">
            <h2>カテゴリ</h2>
            <button
              type="button"
              disabled={busy}
              onClick={() => setCategoryEditing({ mode: "new", parentId: null })}
            >
              カテゴリを追加
            </button>
          </div>
          <ul className="schema-master__cat-tree">
            <li>
              <div className={`schema-master__cat-row${selected === null ? " is-selected" : ""}`}>
                <button
                  type="button"
                  className="schema-master__cat-toggle"
                  style={{ visibility: "hidden" }}
                >
                  ▼
                </button>
                <button
                  type="button"
                  className="schema-master__cat-name"
                  onClick={() => setSelected(null)}
                >
                  (未分類)
                </button>
              </div>
            </li>
            {tree.map((node) => renderNode(node, 0))}
          </ul>
        </div>

        <SchemaListPane
          categoryId={selected}
          categoryName={
            selected === null ? "(未分類)" : categories.find((c) => c.id === selected)?.name ?? ""
          }
          onEdit={setSchemaEditing}
        />
      </div>

      {categoryEditing && (
        <CategoryEditModal
          editing={categoryEditing}
          categories={categories}
          onClose={() => setCategoryEditing(null)}
        />
      )}
      {schemaEditing !== null && (
        <SchemaEditModal
          schema={schemaEditing === "new" ? null : schemaEditing}
          defaultCategoryId={selected}
          categories={categories}
          onClose={() => setSchemaEditing(null)}
        />
      )}
    </div>
  );
}

// 右ペイン: 選択カテゴリ直下のシェーマ一覧。
function SchemaListPane({
  categoryId,
  categoryName,
  onEdit,
}: {
  categoryId: Selection;
  categoryName: string;
  onEdit: (schema: SchemaSummary) => void;
}) {
  const list = useSchemas(categoryId);
  const mutations = useSchemaMutations();
  const items = list.data?.items ?? [];

  function moveSchema(index: number, direction: -1 | 1) {
    const reordered = [...items];
    const target = reordered[index + direction];
    if (!target) return;
    reordered[index + direction] = reordered[index];
    reordered[index] = target;

    reordered.forEach((schema, position) => {
      const display_order = position + 1;
      if (schema.display_order === display_order) return;
      mutations.update.mutate({ id: schema.id, payload: { display_order } });
    });
  }

  return (
    <div className="schema-master__schemas">
      <div className="schema-master__pane-header">
        <h2>{categoryName} のシェーマ</h2>
      </div>
      <ErrorBanner error={list.error} />
      <ErrorBanner error={mutations.update.error} />
      {items.length === 0 ? (
        <p className="patient-table__empty">このカテゴリのシェーマはありません。</p>
      ) : (
        <ul className="schema-master__list">
          {items.map((schema, index) => (
            <li key={schema.id} className="schema-master__item">
              <span className="schema-master__item-order">
                <button
                  type="button"
                  aria-label={`${schema.name} を上へ`}
                  disabled={index === 0 || mutations.update.isPending}
                  onClick={() => moveSchema(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${schema.name} を下へ`}
                  disabled={index === items.length - 1 || mutations.update.isPending}
                  onClick={() => moveSchema(index, 1)}
                >
                  ↓
                </button>
              </span>
              <button type="button" className="schema-master__item-body" onClick={() => onEdit(schema)}>
                <img src={schema.thumbnail} alt="" className="schema-master__thumb" />
                <span className="schema-master__item-name">{schema.name}</span>
                {schema.note && <span className="schema-master__item-note">{schema.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryEditModal({
  editing,
  categories,
  onClose,
}: {
  editing: { mode: "new"; parentId: number | null } | { mode: "edit"; category: SchemaCategory };
  categories: SchemaCategory[];
  onClose: () => void;
}) {
  const mutations = useSchemaCategoryMutations();
  const [name, setName] = useState(editing.mode === "edit" ? editing.category.name : "");
  const [parentId, setParentId] = useState<string>(
    editing.mode === "edit"
      ? editing.category.parent_id === null
        ? ""
        : String(editing.category.parent_id)
      : editing.parentId === null
        ? ""
        : String(editing.parentId),
  );

  // 親カテゴリの選択肢。編集時は自分自身と子孫を除外して循環を作らせない。
  const parentOptions = flattenForSelect(
    buildCategoryTree(categories),
    editing.mode === "edit" ? editing.category.id : undefined,
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const payload = { name: trimmed, parent_id: parentId === "" ? null : Number(parentId) };

    if (editing.mode === "new") {
      await mutations.create.mutateAsync(payload);
    } else {
      await mutations.update.mutateAsync({ id: editing.category.id, payload });
    }
    onClose();
  }

  return (
    <Modal title={editing.mode === "new" ? "カテゴリを追加" : "カテゴリを編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            カテゴリ名
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            親カテゴリ
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">(最上位)</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ErrorBanner error={mutations.create.error ?? mutations.update.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SchemaEditModal({
  schema,
  defaultCategoryId,
  categories,
  onClose,
}: {
  // null は新規作成。
  schema: SchemaSummary | null;
  defaultCategoryId: Selection;
  categories: SchemaCategory[];
  onClose: () => void;
}) {
  const mutations = useSchemaMutations();
  const [name, setName] = useState(schema?.name ?? "");
  const [categoryId, setCategoryId] = useState<string>(() => {
    const initial = schema ? schema.category_id : defaultCategoryId;
    return initial === null ? "" : String(initial);
  });
  const [note, setNote] = useState(schema?.note ?? "");
  // 画像の差し替え(新規時は必須)。image/thumbnail は同時に作る。
  const [picked, setPicked] = useState<{ image: string; thumbnail: string } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const categoryOptions = flattenForSelect(buildCategoryTree(categories));
  const preview = picked?.thumbnail ?? schema?.thumbnail ?? null;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    try {
      const { dataUrl } = await normalizeImageFile(file);
      setPicked({ image: dataUrl, thumbnail: await makeThumbnailDataUrl(dataUrl) });
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "画像を読み込めませんでした。");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (schema === null && !picked) {
      setImageError("画像を選択してください。");
      return;
    }

    const payload = {
      name: trimmed,
      category_id: categoryId === "" ? null : Number(categoryId),
      note: note || null,
      ...(picked ? { image: picked.image, thumbnail: picked.thumbnail } : {}),
    };

    if (schema === null) {
      await mutations.create.mutateAsync(payload);
    } else {
      await mutations.update.mutateAsync({ id: schema.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (schema === null) return;
    if (!window.confirm(`シェーマ「${schema.name}」を削除しますか？`)) return;

    await mutations.remove.mutateAsync(schema.id);
    onClose();
  }

  return (
    <Modal title={schema === null ? "シェーマを追加" : "シェーマを編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            名称
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            カテゴリ
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">(未分類)</option>
              {categoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            画像{schema === null ? "" : "(選択すると差し替え)"}
            <input type="file" accept="image/*" onChange={(e) => void handleFile(e.target.files?.[0])} />
          </label>
          {preview && (
            <div className="schema-master__preview">
              <img src={preview} alt="プレビュー" />
            </div>
          )}
          <label>
            備考
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        {imageError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{imageError}</p>
          </div>
        )}
        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {schema !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
