import { useState, type FormEvent } from "react";
import type {
  MicroCollectionMethod,
  MicroCollectionSite,
  MicroOrderItem,
} from "../api/masterClient";
import {
  useMicroCollectionMethodMutations,
  useMicroCollectionMethods,
  useMicroCollectionSiteMutations,
  useMicroCollectionSites,
  useMicroOrderItemMutations,
  useMicroOrderItems,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

type Tab = "items" | "sites" | "methods";

// 細菌検査オーダーの独自マスタ3種。いずれも数十件規模の小マスタなので、
// 専用ページを分けずタブでまとめる(seed の初期値を施設で直す前提)。
export function MicroOrderItemPage() {
  const [tab, setTab] = useState<Tab>("items");

  return (
    <div className="page">
      <div className="page__header">
        <h1>細菌検査オーダーマスタ</h1>
      </div>

      <div className="dose-conversion__tabs">
        <button
          type="button"
          className={tab === "items" ? "dose-conversion__tab is-active" : "dose-conversion__tab"}
          onClick={() => setTab("items")}
        >
          検査項目
        </button>
        <button
          type="button"
          className={tab === "sites" ? "dose-conversion__tab is-active" : "dose-conversion__tab"}
          onClick={() => setTab("sites")}
        >
          採取部位
        </button>
        <button
          type="button"
          className={tab === "methods" ? "dose-conversion__tab is-active" : "dose-conversion__tab"}
          onClick={() => setTab("methods")}
        >
          採取方法
        </button>
      </div>

      {tab === "items" && <OrderItemTab />}
      {tab === "sites" && <CollectionSiteTab />}
      {tab === "methods" && <CollectionMethodTab />}
    </div>
  );
}

// ---- 検査項目 ----

function OrderItemTab() {
  const list = useMicroOrderItems();
  const [editing, setEditing] = useState<MicroOrderItem | "new" | null>(null);

  return (
    <>
      <div className="page__header-actions">
        <button type="button" onClick={() => setEditing("new")}>
          検査項目を追加
        </button>
      </div>
      <p className="dose-conversion__lead">
        オーダー画面にチェックボックスとして並ぶ検査項目です。廃止は削除ではなく
        有効終了日で行うと、過去のオーダーの表示が保たれます。
      </p>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>名称</th>
            <th>略称</th>
            <th>有効期間</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} onClick={() => setEditing(item)} className="master-search__row">
              <td className="rad-code__compact">{item.item_code}</td>
              <td>{item.name}</td>
              <td>{item.short_name}</td>
              <td>
                {item.valid_from || item.valid_to
                  ? `${item.valid_from ?? ""} 〜 ${item.valid_to ?? ""}`
                  : ""}
              </td>
              <td>{item.note}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={5} className="master-search__empty">
                検査項目がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <OrderItemEditModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function OrderItemEditModal({
  item,
  onClose,
}: {
  // null は新規作成。
  item: MicroOrderItem | null;
  onClose: () => void;
}) {
  const mutations = useMicroOrderItemMutations();
  const [draft, setDraft] = useState({
    item_code: item?.item_code ?? "",
    name: item?.name ?? "",
    short_name: item?.short_name ?? "",
    display_order: item?.display_order === null || item === null ? "" : String(item.display_order),
    valid_from: item?.valid_from ?? "",
    valid_to: item?.valid_to ?? "",
    receipt_code: item?.receipt_code ?? "",
    note: item?.note ?? "",
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.item_code || !draft.name) return;

    const payload = {
      name: draft.name,
      short_name: draft.short_name || null,
      display_order: draft.display_order ? Number(draft.display_order) : null,
      valid_from: draft.valid_from || null,
      valid_to: draft.valid_to || null,
      receipt_code: draft.receipt_code || null,
      note: draft.note || null,
    };
    if (item === null) {
      await mutations.create.mutateAsync({ ...payload, item_code: draft.item_code });
    } else {
      await mutations.update.mutateAsync({ id: item.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (item === null) return;
    if (!window.confirm(`${item.name} を削除しますか？\n過去のオーダーがある項目は削除ではなく有効終了日を設定してください。`)) return;

    await mutations.remove.mutateAsync(item.id);
    onClose();
  }

  return (
    <Modal title={item === null ? "検査項目を追加" : "検査項目を編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            項目コード
            <input
              type="text"
              value={draft.item_code}
              onChange={(e) => setDraft({ ...draft, item_code: e.target.value })}
              disabled={item !== null}
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
            表示順
            <input
              type="number"
              value={draft.display_order}
              onChange={(e) => setDraft({ ...draft, display_order: e.target.value })}
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
            レセ電算コード
            <input
              type="text"
              value={draft.receipt_code}
              onChange={(e) => setDraft({ ...draft, receipt_code: e.target.value })}
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

// ---- 採取部位 ----

function CollectionSiteTab() {
  const list = useMicroCollectionSites();
  const [editing, setEditing] = useState<MicroCollectionSite | "new" | null>(null);

  return (
    <>
      <div className="page__header-actions">
        <button type="button" onClick={() => setEditing("new")}>
          採取部位を追加
        </button>
      </div>
      <p className="dose-conversion__lead">
        「左右あり」の部位を選んだときだけ、オーダー画面で左右を入力できます。
      </p>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>名称</th>
            <th className="rad-code__compact">左右あり</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((site) => (
            <tr key={site.id} onClick={() => setEditing(site)} className="master-search__row">
              <td className="rad-code__compact">{site.code}</td>
              <td>{site.name}</td>
              <td className="rad-code__compact">{site.laterality_applicable ? "○" : ""}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={3} className="master-search__empty">
                採取部位がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <CollectionSiteEditModal
          site={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function CollectionSiteEditModal({
  site,
  onClose,
}: {
  // null は新規作成。
  site: MicroCollectionSite | null;
  onClose: () => void;
}) {
  const mutations = useMicroCollectionSiteMutations();
  const [draft, setDraft] = useState({
    code: site?.code ?? "",
    name: site?.name ?? "",
    laterality_applicable: site?.laterality_applicable ?? false,
    display_order: site?.display_order === null || site === null ? "" : String(site.display_order),
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.code || !draft.name) return;

    const payload = {
      name: draft.name,
      laterality_applicable: draft.laterality_applicable,
      display_order: draft.display_order ? Number(draft.display_order) : null,
    };
    if (site === null) {
      await mutations.create.mutateAsync({ ...payload, code: draft.code });
    } else {
      await mutations.update.mutateAsync({ id: site.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (site === null) return;
    if (!window.confirm(`${site.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(site.id);
    onClose();
  }

  return (
    <Modal title={site === null ? "採取部位を追加" : "採取部位を編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            部位コード
            <input
              type="text"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              disabled={site !== null}
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
            表示順
            <input
              type="number"
              value={draft.display_order}
              onChange={(e) => setDraft({ ...draft, display_order: e.target.value })}
            />
          </label>
          <label className="dose-conversion__checkbox">
            <input
              type="checkbox"
              checked={draft.laterality_applicable}
              onChange={(e) => setDraft({ ...draft, laterality_applicable: e.target.checked })}
            />
            左右あり
          </label>
        </div>

        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {site !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---- 採取方法 ----

function CollectionMethodTab() {
  const list = useMicroCollectionMethods();
  const [editing, setEditing] = useState<MicroCollectionMethod | "new" | null>(null);

  return (
    <>
      <div className="page__header-actions">
        <button type="button" onClick={() => setEditing("new")}>
          採取方法を追加
        </button>
      </div>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>名称</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((method) => (
            <tr key={method.id} onClick={() => setEditing(method)} className="master-search__row">
              <td className="rad-code__compact">{method.code}</td>
              <td>{method.name}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={2} className="master-search__empty">
                採取方法がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <CollectionMethodEditModal
          method={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function CollectionMethodEditModal({
  method,
  onClose,
}: {
  // null は新規作成。
  method: MicroCollectionMethod | null;
  onClose: () => void;
}) {
  const mutations = useMicroCollectionMethodMutations();
  const [draft, setDraft] = useState({
    code: method?.code ?? "",
    name: method?.name ?? "",
    display_order:
      method?.display_order === null || method === null ? "" : String(method.display_order),
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.code || !draft.name) return;

    const payload = {
      name: draft.name,
      display_order: draft.display_order ? Number(draft.display_order) : null,
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
    <Modal title={method === null ? "採取方法を追加" : "採取方法を編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            方法コード
            <input
              type="text"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              disabled={method !== null}
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
            表示順
            <input
              type="number"
              value={draft.display_order}
              onChange={(e) => setDraft({ ...draft, display_order: e.target.value })}
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
