import { useState, type FormEvent } from "react";
import type { PathoCollectionMethod } from "../api/masterClient";
import {
  usePathoCollectionMethodMutations,
  usePathoCollectionMethods,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// 病理検査の採取法(JAHIS 病理・臨床細胞データ交換規約 付録-3 テーブル LPATHO004)。
// 23 件の小マスタなので、seed の初期値をこの画面で直す(細菌検査の採取方法と同じ扱い)。
export function PathoCollectionMethodPage() {
  const [editing, setEditing] = useState<PathoCollectionMethod | "new" | null>(null);
  const list = usePathoCollectionMethods();

  return (
    <div className="page">
      <div className="page__header">
        <h1>病理採取法</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            追加
          </button>
        </div>
      </div>

      <p className="dose-conversion__lead">
        病理検査オーダーの採取法の選択肢です(JAHIS テーブル LPATHO004)。行をクリックすると編集できます。
      </p>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>採取法</th>
            <th className="rad-code__compact">表示順</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((method) => (
            <tr key={method.id} className="master-search__row" onClick={() => setEditing(method)}>
              <td className="rad-code__compact">{method.code}</td>
              <td>{method.name}</td>
              <td className="rad-code__compact">{method.display_order ?? ""}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={3} className="master-search__empty">
                採取法がありません。db:seed で初期値を投入できます。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <MethodEditModal
          method={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface MethodEditModalProps {
  // null は新規作成。
  method: PathoCollectionMethod | null;
  onClose: () => void;
}

function MethodEditModal({ method, onClose }: MethodEditModalProps) {
  const mutations = usePathoCollectionMethodMutations();
  const [draft, setDraft] = useState({
    code: method?.code ?? "",
    name: method?.name ?? "",
    displayOrder: method?.display_order != null ? String(method.display_order) : "",
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.code || !draft.name) return;

    const payload = {
      name: draft.name,
      display_order: draft.displayOrder ? Number(draft.displayOrder) : null,
    };
    if (method === null) {
      await mutations.create.mutateAsync({ ...payload, code: draft.code });
    } else {
      await mutations.update.mutateAsync({ id: method.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (method === null) return;
    if (!window.confirm(`${method.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(method.id);
    onClose();
  }

  return (
    <Modal title={method === null ? "採取法を追加" : "採取法を編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            コード
            <input
              type="text"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              // コードを変えると別のコードになるので、作り直してもらう。
              disabled={method !== null}
              required
            />
          </label>
          <label>
            採取法
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            表示順
            <input
              type="number"
              value={draft.displayOrder}
              onChange={(e) => setDraft({ ...draft, displayOrder: e.target.value })}
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
          {method !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
