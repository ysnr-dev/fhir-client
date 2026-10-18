import { useState, type FormEvent } from "react";
import type { CdsDiscoveredService, CdsServicePayload, CdsServiceSummary } from "../api/adminClient";
import {
  useCdsServices,
  useCreateCdsService,
  useDeleteCdsService,
  useDiscoverCdsServices,
  useOauthClients,
  useUpdateCdsService,
} from "../api/adminQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// CDS Hooks のサービス提供元の台帳(docs/cds-hooks-design.md §3.2)。カルテを開いたときに
// backend が各提供元の patient-view を呼ぶ。「探索」は登録した URL の discovery をその場で読む。

export function CdsServicesPage() {
  const [editing, setEditing] = useState<CdsServiceSummary | "new" | null>(null);
  const [discovered, setDiscovered] = useState<{ name: string; services: CdsDiscoveredService[] } | null>(null);
  const list = useCdsServices();
  const discover = useDiscoverCdsServices();

  function runDiscover(item: CdsServiceSummary) {
    discover.mutate(item.id, { onSuccess: (services) => setDiscovered({ name: item.name, services }) });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>CDS サービス</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            追加
          </button>
        </div>
      </div>
      <p className="oauth-clients__lead">
        カルテを開いたときに呼ぶ外部の判断支援サービス(CDS Hooks の patient-view)の提供元を登録します。
        サービスには prefetch で患者情報を送ります。
      </p>

      <ErrorBanner error={list.error} />
      <ErrorBanner error={discover.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>名称</th>
            <th>URL</th>
            <th className="rad-code__compact">認証</th>
            <th className="rad-code__compact">FHIR 読み取り</th>
            <th className="rad-code__compact">有効</th>
            <th className="rad-code__compact">表示順</th>
            <th className="rad-code__compact"></th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((item) => (
            <tr key={item.id} className="master-search__row" onClick={() => setEditing(item)}>
              <td>{item.name}</td>
              <td className="smart-app-page__url">{item.base_url}</td>
              <td className="rad-code__compact">{item.auth_token_set ? "あり" : "なし"}</td>
              <td className="rad-code__compact">{item.client_id ? "あり" : "なし"}</td>
              <td className="rad-code__compact">{item.enabled ? "有効" : "無効"}</td>
              <td className="rad-code__compact">{item.position}</td>
              <td className="rad-code__compact">
                <button
                  type="button"
                  className="rp-card__compact-button"
                  disabled={discover.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    runDiscover(item);
                  }}
                >
                  探索
                </button>
              </td>
            </tr>
          ))}
          {list.data && list.data.length === 0 && (
            <tr>
              <td colSpan={7} className="master-search__empty">
                提供元がありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <CdsServiceEditModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}

      {discovered && (
        <Modal title={`${discovered.name} のサービス`} onClose={() => setDiscovered(null)}>
          {discovered.services.length === 0 ? (
            <p>サービスがありません。</p>
          ) : (
            <table className="master-search__table">
              <thead>
                <tr>
                  <th>id</th>
                  <th>hook</th>
                  <th>title</th>
                  <th>prefetch</th>
                </tr>
              </thead>
              <tbody>
                {discovered.services.map((service) => (
                  <tr key={service.id}>
                    <td>{service.id}</td>
                    <td>{service.hook}</td>
                    <td>{service.title}</td>
                    <td>{service.prefetch.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  );
}

interface CdsServiceEditModalProps {
  // null は新規作成。
  item: CdsServiceSummary | null;
  onClose: () => void;
}

function CdsServiceEditModal({ item, onClose }: CdsServiceEditModalProps) {
  const create = useCreateCdsService();
  const update = useUpdateCdsService();
  const remove = useDeleteCdsService();
  const clients = useOauthClients();
  // fhirAuthorization の発行先に選べるのは CDS サービス用(委任)のクライアントだけ。
  const delegatedClients = clients.data?.filter((client) => client.kind === "delegated") ?? [];
  const [draft, setDraft] = useState({
    name: item?.name ?? "",
    baseUrl: item?.base_url ?? "",
    clientId: item?.client_id ?? "",
    authToken: "",
    enabled: item?.enabled ?? true,
    position: item?.position != null ? String(item.position) : "",
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim() || !draft.baseUrl.trim()) return;

    const payload: CdsServicePayload = {
      name: draft.name.trim(),
      base_url: draft.baseUrl.trim(),
      client_id: draft.clientId || null,
      enabled: draft.enabled,
      position: draft.position ? Number(draft.position) : null,
    };
    // 認証トークンは入力があったときだけ送る(空欄なら既存値を保持)。
    if (draft.authToken) payload.auth_token = draft.authToken;
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
    <Modal title={item === null ? "提供元を追加" : "提供元を編集"} onClose={onClose}>
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
          <label className="smart-app-page__url-field">
            URL
            <input
              type="url"
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              required
            />
          </label>
          <label className="smart-app-page__url-field">
            認証トークン
            <input
              type="password"
              value={draft.authToken}
              autoComplete="new-password"
              placeholder={item?.auth_token_set ? "設定済み（変更する場合のみ入力）" : ""}
              onChange={(e) => setDraft({ ...draft, authToken: e.target.value })}
            />
          </label>
          <label className="smart-app-page__url-field">
            FHIR 読み取り用の OAuth クライアント
            <select value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}>
              <option value="">(渡さない)</option>
              {delegatedClients.map((client) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.name}
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

        <ErrorBanner error={clients.error} />
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
