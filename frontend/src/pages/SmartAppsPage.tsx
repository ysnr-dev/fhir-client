import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { SmartAppDisplay, SmartAppPayload, SmartAppSummary } from "../api/adminClient";
import {
  useCreateSmartApp,
  useDeleteSmartApp,
  useOauthClients,
  useSmartApps,
  useUpdateSmartApp,
} from "../api/adminQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// カルテの「SMARTアプリ」タブから起動する SMART on FHIR アプリの台帳(docs/smart-app-launch-design.md)。
// 認可の実体は上流の OAuth クライアント(launch 形・launch スコープ付き)で、ここは
// 名称・起動 URL・表示方法・並び順を持つ。

const DISPLAY_LABELS: Record<SmartAppDisplay, string> = {
  embed: "埋め込み",
  window: "別ウィンドウ",
};

export function SmartAppsPage() {
  const [editing, setEditing] = useState<SmartAppSummary | "new" | null>(null);
  const list = useSmartApps();
  const clients = useOauthClients();

  function clientName(clientId: string): string {
    return clients.data?.find((client) => client.client_id === clientId)?.name ?? clientId;
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>SMART アプリ</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            追加
          </button>
        </div>
      </div>
      <p className="oauth-clients__lead">
        カルテの「SMARTアプリ」タブから起動する外部アプリを登録します。先に
        <Link to="/oauth-clients">OAuth クライアント</Link>
        でアプリ連携(医療従事者・launch スコープ付き)のクライアントを登録してください。
      </p>

      <ErrorBanner error={list.error} />
      <ErrorBanner error={clients.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>名称</th>
            <th>OAuth クライアント</th>
            <th>起動 URL</th>
            <th className="rad-code__compact">表示</th>
            <th className="rad-code__compact">有効</th>
            <th className="rad-code__compact">表示順</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((item) => (
            <tr key={item.id} className="master-search__row" onClick={() => setEditing(item)}>
              <td>{item.name}</td>
              <td>{clientName(item.client_id)}</td>
              <td className="smart-app-page__url">{item.launch_url}</td>
              <td className="rad-code__compact">{DISPLAY_LABELS[item.display]}</td>
              <td className="rad-code__compact">{item.enabled ? "有効" : "無効"}</td>
              <td className="rad-code__compact">{item.position}</td>
            </tr>
          ))}
          {list.data && list.data.length === 0 && (
            <tr>
              <td colSpan={6} className="master-search__empty">
                アプリがありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <SmartAppEditModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

interface SmartAppEditModalProps {
  // null は新規作成。
  item: SmartAppSummary | null;
  onClose: () => void;
}

function SmartAppEditModal({ item, onClose }: SmartAppEditModalProps) {
  const create = useCreateSmartApp();
  const update = useUpdateSmartApp();
  const remove = useDeleteSmartApp();
  const clients = useOauthClients();
  const [draft, setDraft] = useState({
    name: item?.name ?? "",
    clientId: item?.client_id ?? "",
    launchUrl: item?.launch_url ?? "",
    display: item?.display ?? ("embed" as SmartAppDisplay),
    enabled: item?.enabled ?? true,
    position: item?.position != null ? String(item.position) : "",
  });

  // 選べるのはアプリ連携(launch 形)のクライアントだけ。EHR launch で起動できるのは
  // launch スコープを登録したものに限るので、そうでないものは選択肢で分かるようにする。
  const launchClients = clients.data?.filter((client) => client.kind === "launch") ?? [];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim() || !draft.clientId || !draft.launchUrl.trim()) return;

    const payload: SmartAppPayload = {
      name: draft.name.trim(),
      client_id: draft.clientId,
      launch_url: draft.launchUrl.trim(),
      display: draft.display,
      enabled: draft.enabled,
      position: draft.position ? Number(draft.position) : null,
    };
    if (item === null) {
      await create.mutateAsync(payload);
    } else {
      await update.mutateAsync({ id: item.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (item === null) return;
    if (!window.confirm(`${item.name} を削除しますか？`)) return;

    await remove.mutateAsync(item.id);
    onClose();
  }

  return (
    <Modal title={item === null ? "アプリを追加" : "アプリを編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
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
            OAuth クライアント
            <select
              value={draft.clientId}
              onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}
              required
            >
              <option value="">(選択)</option>
              {launchClients.map((client) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.name}
                  {client.ehr_launchable ? "" : "(launch 未登録)"}
                </option>
              ))}
            </select>
          </label>
          <label className="smart-app-page__url-field">
            起動 URL
            <input
              type="url"
              value={draft.launchUrl}
              onChange={(e) => setDraft({ ...draft, launchUrl: e.target.value })}
              required
            />
          </label>
          <label>
            表示
            <select
              value={draft.display}
              onChange={(e) => setDraft({ ...draft, display: e.target.value as SmartAppDisplay })}
            >
              {(Object.keys(DISPLAY_LABELS) as SmartAppDisplay[]).map((display) => (
                <option key={display} value={display}>
                  {DISPLAY_LABELS[display]}
                </option>
              ))}
            </select>
          </label>
          <label>
            表示順
            <input
              type="number"
              value={draft.position}
              onChange={(e) => setDraft({ ...draft, position: e.target.value })}
            />
          </label>
          <label className="smart-app-page__check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            有効
          </label>
        </div>

        <ErrorBanner error={create.error ?? update.error ?? remove.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={create.isPending || update.isPending}>
            保存
          </button>
          {item !== null && (
            <button type="button" onClick={handleDelete} disabled={remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
