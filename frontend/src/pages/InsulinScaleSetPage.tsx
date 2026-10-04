import { useState, type FormEvent } from "react";
import type { InsulinScaleSet } from "../api/masterClient";
import { useInsulinScaleSetMutations, useInsulinScaleSets } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { InsulinScaleEditor } from "../components/InsulinScaleEditor";
import { Modal } from "../components/Modal";
import {
  emptyInsulinScale,
  filledInsulinScaleRows,
  insulinScaleFromSet,
  insulinScaleKindDisplay,
  insulinScaleSummary,
  validateInsulinScale,
  type InsulinScaleValues,
} from "../fhir/insulinScaleHelpers";

// インスリンのスライディングスケールのセット。注射オーダーのスケールの入力で選ぶと行が写る。
export function InsulinScaleSetPage() {
  const [editing, setEditing] = useState<InsulinScaleSet | "new" | null>(null);
  const list = useInsulinScaleSets();

  return (
    <div className="page">
      <div className="page__header">
        <h1>スケールセット</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            追加
          </button>
        </div>
      </div>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>名称</th>
            <th className="rad-code__compact">種別</th>
            <th>内容</th>
            <th className="rad-code__compact">表示順</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} className="master-search__row" onClick={() => setEditing(item)}>
              <td>{item.name}</td>
              <td className="rad-code__compact">{insulinScaleKindDisplay(item.kind)}</td>
              <td>{insulinScaleSummary(insulinScaleFromSet(item))}</td>
              <td className="rad-code__compact">{item.display_order ?? ""}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={4} className="master-search__empty">
                スケールセットがありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <ScaleSetEditModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ScaleSetEditModal({ item, onClose }: { item: InsulinScaleSet | null; onClose: () => void }) {
  const mutations = useInsulinScaleSetMutations();
  const [name, setName] = useState(item?.name ?? "");
  const [displayOrder, setDisplayOrder] = useState(item?.display_order != null ? String(item.display_order) : "");
  const [scale, setScale] = useState<InsulinScaleValues>(() =>
    item ? insulinScaleFromSet(item) : emptyInsulinScale(),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const errors = validateInsulinScale(scale);
    if (errors.length) {
      setValidationError(errors[0]);
      return;
    }
    setValidationError(null);

    const payload = {
      name: name.trim(),
      kind: scale.kind,
      rows: filledInsulinScaleRows(scale).map((row) =>
        scale.kind === "free"
          ? { condition: row.condition, dose: row.dose, note: row.note }
          : { low: row.low, high: row.high, dose: row.dose, note: row.note },
      ),
      display_order: displayOrder ? Number(displayOrder) : null,
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

  return (
    <Modal
      title={item === null ? "スケールセットを追加" : "スケールセットを編集"}
      onClose={onClose}
      className="modal--wide"
    >
      <form className="prescription-form" onSubmit={handleSubmit}>
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
            表示順
            <input type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
          </label>
        </div>

        <InsulinScaleEditor scale={scale} onChange={setScale} />

        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {item !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
