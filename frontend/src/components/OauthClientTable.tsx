import type { OauthClientSummary } from "../api/adminClient";
import { useDeleteOauthClient } from "../api/adminQueries";
import { ErrorBanner } from "./ErrorBanner";

const KIND_LABELS: Record<OauthClientSummary["kind"], string> = {
  backend: "バックエンド連携",
  launch: "アプリ連携",
};

const AUTH_METHOD_LABELS: Record<OauthClientSummary["auth_method"], string> = {
  client_secret: "client_secret",
  private_key_jwt: "private_key_jwt",
  none: "PKCE のみ",
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("ja-JP");
}

export function OauthClientTable({ clients }: { clients: OauthClientSummary[] }) {
  const deleteClient = useDeleteOauthClient();

  function handleDelete(client: OauthClientSummary) {
    // 削除は物理削除で、発行済みトークンも同時に失効する。件数を文面に入れて
    // 「何が壊れるか」を先に見せる。
    const tokens =
      `アクセストークン${client.active_access_token_count}件・` +
      `リフレッシュトークン${client.active_refresh_token_count}件`;
    if (
      !window.confirm(
        `${client.name} を削除します。有効な${tokens}も無効になり、元に戻せません。よろしいですか?`,
      )
    ) {
      return;
    }
    deleteClient.mutate(client.client_id);
  }

  if (clients.length === 0) {
    return <p className="oauth-client-table__empty">登録されているクライアントはありません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteClient.error} />
      <div className="oauth-client-table__scroll">
        <table className="oauth-client-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>client_id</th>
              <th>種別</th>
              <th>認証方式</th>
              <th>スコープ</th>
              <th>リダイレクトURI</th>
              <th>有効トークン</th>
              <th>作成日時</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.client_id}>
                <td>{client.name}</td>
                <td>
                  <code className="oauth-client-table__id">{client.client_id}</code>
                </td>
                <td>{KIND_LABELS[client.kind]}</td>
                <td>
                  {AUTH_METHOD_LABELS[client.auth_method]}
                  {client.auth_method === "private_key_jwt" && ` (${client.jwks_key_count}鍵)`}
                </td>
                <td>
                  <ul className="oauth-client-table__scopes">
                    {client.scopes.map((scope) => (
                      <li key={scope}>
                        <code>{scope}</code>
                      </li>
                    ))}
                  </ul>
                </td>
                <td>
                  {client.redirect_uris.length === 0 ? (
                    "-"
                  ) : (
                    <ul className="oauth-client-table__uris">
                      {client.redirect_uris.map((uri) => (
                        <li key={uri}>{uri}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>
                  A: {client.active_access_token_count} / R: {client.active_refresh_token_count}
                </td>
                <td>{formatDateTime(client.created_at)}</td>
                <td className="oauth-client-table__actions">
                  <button
                    type="button"
                    onClick={() => handleDelete(client)}
                    disabled={deleteClient.isPending}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
