import { useState } from "react";
import type { FileCategorySummary } from "../api/adminClient";
import {
  useCreateFileCategory,
  useDeleteFileCategory,
  useFileCategories,
  useUpdateFileCategory,
} from "../api/adminQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// ファイルカテゴリ(独自マスタ)の管理。カルテの「ファイル」タブから開く。
// カテゴリ自体の追加・改名・並べ替え・削除だけを行い、どのファイルに付けるかは
// ファイルの登録・編集で設定する。

export function FileCategoryModal({ onClose }: { onClose: () => void }) {
  const { data: categories = [], isLoading, error } = useFileCategories();
  const create = useCreateFileCategory();
  const update = useUpdateFileCategory();
  const remove = useDeleteFileCategory();

  const [newName, setNewName] = useState("");
  // 改名の編集中の値(未編集の行は元の名前を表示する)。
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const busy = create.isPending || update.isPending || remove.isPending;

  function nameOf(category: FileCategorySummary): string {
    return drafts[category.id] ?? category.name;
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    create.mutate({ name }, { onSuccess: () => setNewName("") });
  }

  function handleRename(category: FileCategorySummary) {
    const name = nameOf(category).trim();
    if (!name || name === category.name) return;
    update.mutate(
      { id: category.id, payload: { name } },
      {
        onSuccess: () =>
          setDrafts((prev) => {
            const next = { ...prev };
            delete next[category.id];
            return next;
          }),
      },
    );
  }

  // 隣と入れ替える。並びが飛び番でも意図どおりになるよう、変わる行だけ
  // 1 始まりの連番へ振り直す(初回だけ全行、以降は実質2行)。
  function handleMove(index: number, direction: -1 | 1) {
    const reordered = [...categories];
    const target = reordered[index + direction];
    if (!target) return;
    reordered[index + direction] = reordered[index];
    reordered[index] = target;

    reordered.forEach((category, position) => {
      const display_order = position + 1;
      if (category.display_order === display_order) return;
      update.mutate({ id: category.id, payload: { display_order } });
    });
  }

  function handleDelete(category: FileCategorySummary) {
    if (
      !window.confirm(
        `カテゴリ「${category.name}」を削除します。\n` +
          "このカテゴリで取り込み済みのファイルは同じ名前のまま残りますが、" +
          "絞り込みの選択肢からは消えます。よろしいですか?",
      )
    ) {
      return;
    }
    remove.mutate(category.id);
  }

  return (
    <Modal title="ファイルカテゴリ" onClose={onClose}>
      <ErrorBanner error={error} />
      <ErrorBanner error={create.error} />
      <ErrorBanner error={update.error} />
      <ErrorBanner error={remove.error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : categories.length === 0 ? (
        <p className="patient-table__empty">カテゴリがまだありません。</p>
      ) : (
        <ul className="category-modal__list">
          {categories.map((category, index) => (
            <li key={category.id} className="category-modal__row">
              <span className="category-modal__order">
                <button
                  type="button"
                  aria-label={`${category.name} を上へ`}
                  disabled={index === 0 || busy}
                  onClick={() => handleMove(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${category.name} を下へ`}
                  disabled={index === categories.length - 1 || busy}
                  onClick={() => handleMove(index, 1)}
                >
                  ↓
                </button>
              </span>
              <input
                type="text"
                aria-label={`${category.name} の名前`}
                value={nameOf(category)}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [category.id]: e.target.value }))}
              />
              <button
                type="button"
                disabled={busy || nameOf(category).trim() === category.name}
                onClick={() => handleRename(category)}
              >
                保存
              </button>
              <button
                type="button"
                className="category-modal__delete category-modal__delete--icon icon-tooltip"
                data-tooltip="削除"
                aria-label={`${category.name} を削除`}
                disabled={busy}
                onClick={() => handleDelete(category)}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="category-modal__add">
        <input
          type="text"
          aria-label="追加するカテゴリ名"
          placeholder="カテゴリ名"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <button type="button" disabled={busy || !newName.trim()} onClick={handleAdd}>
          追加
        </button>
      </div>
    </Modal>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
