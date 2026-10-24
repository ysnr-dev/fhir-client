import { useState } from "react";
import type { MealPattern } from "../api/masterClient";
import { useMealPatternMutations, useMealPatterns } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { MealPatternStepModal } from "../components/MealPatternStepModal";
import { MealPatternStepsTable } from "../components/MealPatternStepsTable";
import { Modal } from "../components/Modal";
import {
  mealPatternStepsOf,
  mealPatternStepsSummary,
  validateMealPatternSteps,
  type MealPatternStep,
} from "../fhir/mealPatternHelpers";
import { MasterBackLink } from "../components/MasterBackLink";

// パターン食。術後の食上げ(流動食 → 三分粥 → … → 常食)のように段階的に変わる食事の雛形で、
// 食事オーダー画面で選ぶと段階ごとのオーダーがまとめて立つ(docs/meal-order-design.md §3.5)。
export function MealPatternPage() {
  const [editing, setEditing] = useState<MealPattern | "new" | null>(null);
  const list = useMealPatterns();

  return (
    <div className="page">
      <div className="page__header">
        <h1>パターン食</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            追加
          </button>
          <MasterBackLink />
        </div>
      </div>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>名称</th>
            <th>内容</th>
            <th className="rad-code__compact">表示順</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} className="master-search__row" onClick={() => setEditing(item)}>
              <td className="rad-code__compact">{item.pattern_code}</td>
              <td>{item.name}</td>
              <td>{mealPatternStepsSummary(mealPatternStepsOf(item))}</td>
              <td className="rad-code__compact">{item.display_order ?? ""}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={4} className="master-search__empty">
                パターン食がありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <PatternEditModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/**
 * 1 パターンの編集。段階の編集モーダルが食事オーダーのフォーム(<form>)を含むので、
 * こちらの本体は <form> にしない(Modal は非ポータルで、入れ子の form になるため)。
 */
function PatternEditModal({ item, onClose }: { item: MealPattern | null; onClose: () => void }) {
  const mutations = useMealPatternMutations();
  const [name, setName] = useState(item?.name ?? "");
  const [nameKana, setNameKana] = useState(item?.name_kana ?? "");
  const [displayOrder, setDisplayOrder] = useState(item?.display_order != null ? String(item.display_order) : "");
  const [note, setNote] = useState(item?.note ?? "");
  const [steps, setSteps] = useState<MealPatternStep[]>(() => (item ? mealPatternStepsOf(item) : []));
  // 段階編集モーダル。"new" は追加、数値は直す段階の添字。
  const [editingStep, setEditingStep] = useState<number | "new" | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) {
      setValidationError("名称を入れてください。");
      return;
    }
    const error = validateMealPatternSteps(steps);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    const payload = {
      name: name.trim(),
      name_kana: nameKana.trim() || null,
      steps: steps.map((step) => ({ meals: step.meals, ...step.values })),
      display_order: displayOrder ? Number(displayOrder) : null,
      note: note.trim() || null,
    };
    if (item === null) {
      await mutations.create.mutateAsync(payload);
    } else {
      await mutations.update.mutateAsync({ id: item.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (item === null) return;
    if (!window.confirm(`${item.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(item.id);
    onClose();
  }

  function handleStepSave(step: MealPatternStep) {
    setSteps((prev) =>
      editingStep === "new" ? [...prev, step] : prev.map((s, i) => (i === editingStep ? step : s)),
    );
    setEditingStep(null);
  }

  return (
    <Modal
      title={item === null ? "パターン食を追加" : "パターン食を編集"}
      onClose={onClose}
      className="modal--wide"
    >
      <div className="prescription-form">
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <div className="lab-order-item__fields">
          <label>
            名称
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            カナ
            <input type="text" value={nameKana} onChange={(e) => setNameKana(e.target.value)} />
          </label>
          <label>
            表示順
            <input type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
          </label>
          <label>
            備考
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        <fieldset>
          <legend>段階</legend>
          <div className="meal-pattern-steps__wrap">
            <MealPatternStepsTable steps={steps} onChange={setSteps} onEdit={(index) => setEditingStep(index)} />
            <div className="rp-card__actions">
              <button type="button" className="rp-card__compact-button" onClick={() => setEditingStep("new")}>
                + 段階
              </button>
            </div>
          </div>
        </fieldset>

        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button
            type="button"
            onClick={handleSave}
            disabled={mutations.create.isPending || mutations.update.isPending}
          >
            保存
          </button>
          {item !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </div>

      {editingStep !== null && (
        <MealPatternStepModal
          step={editingStep === "new" ? null : steps[editingStep]}
          onSave={handleStepSave}
          onClose={() => setEditingStep(null)}
        />
      )}
    </Modal>
  );
}
