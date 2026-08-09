import { useEffect, useState, type FormEvent } from "react";
import type { LabContainer, LabContainerPayload } from "../api/masterClient";
import { useLabContainerMutations, useLabContainers } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

interface Draft {
  container_code: string;
  name: string;
  short_name: string;
  cap_color: string;
  additive: string;
  capacity: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  container_code: "",
  name: "",
  short_name: "",
  cap_color: "",
  additive: "",
  capacity: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): LabContainerPayload {
  return {
    container_code: draft.container_code,
    name: draft.name,
    short_name: draft.short_name || null,
    cap_color: draft.cap_color || null,
    additive: draft.additive || null,
    capacity: draft.capacity || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function LabContainerPage() {
  const list = useLabContainers();
  const [editing, setEditing] = useState<LabContainer | "new" | null>(null);

  return (
    <div className="page">
      <div className="page__header">
        <h1>採取管マスタ</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            採取管を追加
          </button>
        </div>
      </div>

      <p className="dose-conversion__lead">
        採血管・採尿容器などの採取容器です。呼称やキャップ色は施設ごとに直してください。
        検体マスタの「既定採取管」と検査オーダー項目の採取管指定から参照されます。
      </p>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>コード</th>
            <th>名称</th>
            <th>略称</th>
            <th className="lab-order-item__compact">キャップ色</th>
            <th>添加剤</th>
            <th className="lab-order-item__compact">容量</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((container) => (
            <tr key={container.id} onClick={() => setEditing(container)} className="master-search__row">
              <td>{container.container_code}</td>
              <td>{container.name}</td>
              <td>{container.short_name}</td>
              <td className="lab-order-item__compact">{container.cap_color}</td>
              <td>{container.additive}</td>
              <td className="lab-order-item__compact">{container.capacity}</td>
              <td>{container.note}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={7} className="master-search__empty">
                採取管がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <ContainerEditModal
          container={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface ContainerEditModalProps {
  // null は新規作成。
  container: LabContainer | null;
  onClose: () => void;
}

function ContainerEditModal({ container, onClose }: ContainerEditModalProps) {
  const mutations = useLabContainerMutations();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (!container) return;
    setDraft({
      container_code: container.container_code,
      name: container.name,
      short_name: container.short_name ?? "",
      cap_color: container.cap_color ?? "",
      additive: container.additive ?? "",
      capacity: container.capacity ?? "",
      display_order: container.display_order === null ? "" : String(container.display_order),
      note: container.note ?? "",
    });
  }, [container]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.container_code || !draft.name) return;

    if (container === null) {
      await mutations.create.mutateAsync(toPayload(draft));
    } else {
      await mutations.update.mutateAsync({ id: container.id, payload: toPayload(draft) });
    }
    onClose();
  }

  async function handleDelete() {
    if (container === null) return;
    if (!window.confirm(`${container.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(container.id);
    onClose();
  }

  return (
    <Modal title={container === null ? "採取管を追加" : "採取管を編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            採取管コード
            <input
              type="text"
              value={draft.container_code}
              onChange={(e) => setDraft({ ...draft, container_code: e.target.value })}
              disabled={container !== null}
              required
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
            略称
            <input
              type="text"
              value={draft.short_name}
              onChange={(e) => setDraft({ ...draft, short_name: e.target.value })}
            />
          </label>
          <label>
            キャップ色
            <input
              type="text"
              value={draft.cap_color}
              onChange={(e) => setDraft({ ...draft, cap_color: e.target.value })}
            />
          </label>
          <label>
            添加剤・抗凝固剤
            <input
              type="text"
              value={draft.additive}
              onChange={(e) => setDraft({ ...draft, additive: e.target.value })}
            />
          </label>
          <label>
            容量
            <input
              type="text"
              value={draft.capacity}
              onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
              placeholder="5mL"
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

        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {container !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
