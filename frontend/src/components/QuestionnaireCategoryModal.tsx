import { useState } from "react";
import type { QuestionnaireCategorySummary } from "../api/adminClient";
import {
  useCreateQuestionnaireCategory,
  useDeleteQuestionnaireCategory,
  useQuestionnaireCategories,
  useUpdateQuestionnaireCategory,
} from "../api/adminQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// テンプレートカテゴリ(独自マスタ)の管理。テンプレート一覧から開く。
// カテゴリ自体の追加・改名・並べ替え・削除だけを行い、どのテンプレートに
// 付けるかはテンプレート編集画面で設定する。

export function QuestionnaireCategoryModal({ onClose }: { onClose: () => void }) {
  const { data: categories = [], isLoading, error } = useQuestionnaireCategories();
  const create = useCreateQuestionnaireCategory();
  const update = useUpdateQuestionnaireCategory();
  const remove = useDeleteQuestionnaireCategory();

  const [newName, setNewName] = useState("");
  // 改名の編集中の値(未編集の行は元の名前を表示する)。
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const busy = create.isPending || update.isPending || remove.isPending;

  function nameOf(category: QuestionnaireCategorySummary): string {
    return drafts[category.id] ?? category.name;
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    create.mutate({ name }, { onSuccess: () => setNewName("") });
  }

  function handleRename(category: QuestionnaireCategorySummary) {
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

  function handleDelete(category: QuestionnaireCategorySummary) {
    if (
      !window.confirm(
        `カテゴリ「${category.name}」を削除します。\n` +
          "このカテゴリを設定済みのテンプレートは、テンプレート編集画面でカテゴリを変更するまで" +
          "同じ名前でまとめて表示されます。よろしいですか?",
      )
    ) {
      return;
    }
    remove.mutate(category.id);
  }

  return (
    <Modal title="テンプレートカテゴリ" onClose={onClose}>
      <ErrorBanner error={error} />
      <ErrorBanner error={create.error} />
      <ErrorBanner error={update.error} />
      <ErrorBanner error={remove.error} />

      <p className="qc-modal__hint">
        テンプレート選択のプルダウンで使う分類です。並び順はプルダウンの表示順になります。
      </p>

      {isLoading ? (
        <p>読み込み中...</p>
      ) : categories.length === 0 ? (
        <p className="patient-table__empty">カテゴリがまだありません。</p>
      ) : (
        <ul className="qc-modal__list">
          {categories.map((category, index) => (
            <li key={category.id} className="qc-modal__row">
              <span className="qc-modal__order">
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
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [category.id]: e.target.value }))
                }
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
                className="qc-modal__delete"
                disabled={busy}
                onClick={() => handleDelete(category)}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="qc-modal__add">
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
