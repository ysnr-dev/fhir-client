import { useState } from "react";
import { useSchemaCategories, useSchemas } from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { buildCategoryTree, type CategoryNode } from "./schemaCategoryTree";

// 診療記録に挿入するシェーマ(台紙)の選択モーダル。左のカテゴリツリーで絞り込み、
// 右のサムネイルグリッドから選ぶ。選択すると onSelect(id) を返すだけで、
// 台紙本体(image)の取得は呼び出し側が行う。

interface SchemaPickerModalProps {
  onSelect: (schemaId: number) => void;
  onClose: () => void;
}

export function SchemaPickerModal({ onSelect, onClose }: SchemaPickerModalProps) {
  const categoriesQuery = useSchemaCategories();
  // undefined は全カテゴリ、null は未分類。既定は全件(登録が少ないうちに探しやすい)。
  const [selected, setSelected] = useState<number | null | undefined>(undefined);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // 名称検索。件数は多くない想定なので入力のたびに引き直す(サーバー側 LIKE)。
  const [name, setName] = useState("");

  const schemasQuery = useSchemas(selected, name);
  const categories = categoriesQuery.data?.items ?? [];
  const tree = buildCategoryTree(categories);
  const items = schemasQuery.data?.items ?? [];

  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(node: CategoryNode, depth: number) {
    const { category, children } = node;
    const isCollapsed = collapsed.has(category.id);
    return (
      <li key={category.id}>
        <div
          className={`schema-picker__cat${selected === category.id ? " is-selected" : ""}`}
          style={{ paddingLeft: `${depth * 14}px` }}
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
    <Modal title="シェーマを選択" onClose={onClose} className="modal--schema-picker">
      <ErrorBanner error={categoriesQuery.error ?? schemasQuery.error} />

      <div className="schema-picker">
        <div className="schema-picker__categories">
          <ul className="schema-master__cat-tree">
            <li>
              <div className={`schema-picker__cat${selected === undefined ? " is-selected" : ""}`}>
                <button type="button" className="schema-master__cat-toggle" style={{ visibility: "hidden" }}>
                  ▼
                </button>
                <button type="button" className="schema-master__cat-name" onClick={() => setSelected(undefined)}>
                  すべて
                </button>
              </div>
            </li>
            <li>
              <div className={`schema-picker__cat${selected === null ? " is-selected" : ""}`}>
                <button type="button" className="schema-master__cat-toggle" style={{ visibility: "hidden" }}>
                  ▼
                </button>
                <button type="button" className="schema-master__cat-name" onClick={() => setSelected(null)}>
                  (未分類)
                </button>
              </div>
            </li>
            {tree.map((node) => renderNode(node, 0))}
          </ul>
        </div>

        <div className="schema-picker__main">
          <input
            type="search"
            className="schema-picker__search"
            placeholder="名称で検索"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {schemasQuery.isLoading ? (
            <p>読み込み中...</p>
          ) : items.length === 0 ? (
            <p className="patient-table__empty">
              シェーマがありません。マスタメンテの「シェーマ」から登録してください。
            </p>
          ) : (
            <div className="schema-picker__grid">
              {items.map((schema) => (
                <button
                  key={schema.id}
                  type="button"
                  className="schema-picker__card"
                  onClick={() => onSelect(schema.id)}
                >
                  <img src={schema.thumbnail} alt="" />
                  <span>{schema.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
