import { useState } from "react";
import type { ConnectionSettings, ConnectionSettingsUpdate } from "../api/adminClient";
import {
  useConnectionSettings,
  useTestConnection,
  useUpdateConnectionSettings,
} from "../api/adminQueries";
import { ErrorBanner } from "../components/ErrorBanner";

export function ConnectionSettingsPage() {
  const { data, isLoading, error } = useConnectionSettings();

  return (
    <div className="page">
      <div className="page__header">
        <h1>接続設定</h1>
      </div>
      <p className="connection-settings__lead">
        上流 FHIR サーバーへの接続(SMART Backend Services / client_credentials)を設定します。
        入力値は環境変数より優先され、空欄の項目は環境変数の値にフォールバックします。
      </p>
      {isLoading && <p>読み込み中...</p>}
      <ErrorBanner error={error} />
      {data && <ConnectionSettingsForm settings={data} />}
    </div>
  );
}

function sourceLabel(settings: ConnectionSettings): string {
  switch (settings.effective_auth_source) {
    case "db":
      return "DB の設定を使用中";
    case "env":
      return "環境変数の設定にフォールバック中";
    default:
      return "認証情報なし(パススルー動作)";
  }
}

function ConnectionSettingsForm({ settings }: { settings: ConnectionSettings }) {
  const [baseUrl, setBaseUrl] = useState(settings.base_url ?? "");
  const [clientId, setClientId] = useState(settings.client_id ?? "");
  const [tokenPath, setTokenPath] = useState(settings.token_path || "/oauth/token");
  const [hostHeader, setHostHeader] = useState(settings.host_header ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [secretSet, setSecretSet] = useState(settings.client_secret_set);
  const [adminToken, setAdminToken] = useState("");
  const [adminTokenSet, setAdminTokenSet] = useState(settings.fhir_admin_token_set);

  const update = useUpdateConnectionSettings();
  const test = useTestConnection();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const payload: ConnectionSettingsUpdate = {
      base_url: baseUrl,
      client_id: clientId,
      token_path: tokenPath,
      host_header: hostHeader,
    };
    // 秘密の類は入力があったときだけ送る(空欄なら既存値を保持)。
    if (clientSecret) payload.client_secret = clientSecret;
    if (adminToken) payload.fhir_admin_token = adminToken;

    update.mutate(payload, {
      onSuccess: (data) => {
        setSecretSet(data.client_secret_set);
        setAdminTokenSet(data.fhir_admin_token_set);
        setClientSecret("");
        setAdminToken("");
      },
    });
  }

  return (
    <form className="connection-settings-form" onSubmit={handleSubmit}>
      <p className="connection-settings-form__status" role="status">
        現在の状態: {sourceLabel(settings)}
        {settings.auth_enabled ? "（認証あり）" : "（認証なし）"}
      </p>

      <label>
        FHIR サーバー URL
        <input
          type="url"
          value={baseUrl}
          placeholder="http://localhost:3000"
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </label>

      <label>
        Client ID
        <input
          type="text"
          value={clientId}
          autoComplete="off"
          onChange={(e) => setClientId(e.target.value)}
        />
      </label>

      <label>
        Client Secret
        <input
          type="password"
          value={clientSecret}
          autoComplete="new-password"
          placeholder={secretSet ? "設定済み（変更する場合のみ入力）" : "未設定"}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </label>

      <label>
        Token エンドポイント パス
        <input
          type="text"
          value={tokenPath}
          placeholder="/oauth/token"
          onChange={(e) => setTokenPath(e.target.value)}
        />
      </label>

      <label>
        Host ヘッダー（任意）
        <input
          type="text"
          value={hostHeader}
          placeholder="通常は空欄"
          onChange={(e) => setHostHeader(e.target.value)}
        />
      </label>

      <label>
        FHIR 管理トークン（OAuth クライアント管理用）
        <input
          type="password"
          value={adminToken}
          autoComplete="new-password"
          placeholder={adminTokenSet ? "設定済み（変更する場合のみ入力）" : "未設定"}
          onChange={(e) => setAdminToken(e.target.value)}
        />
        <span className="connection-settings-form__field-hint">
          上流 FHIR サーバーの <code>FHIR_ADMIN_TOKEN</code> と同じ値。OAuth クライアントの
          一覧・登録・削除に使います（client_secret とは別のトークンです）。
        </span>
      </label>

      <div className="connection-settings-form__actions">
        <button type="submit" disabled={update.isPending}>
          {update.isPending ? "保存中..." : "保存"}
        </button>
        <button
          type="button"
          disabled={test.isPending}
          onClick={() => test.mutate()}
        >
          {test.isPending ? "接続テスト中...(最大90秒)" : "接続テスト"}
        </button>
      </div>
      <p className="connection-settings-form__hint">
        接続テストは保存済みの設定に対して実行されます。上流がスリープ中の場合、初回は最大90秒ほどかかることがあります。
      </p>

      {update.isSuccess && (
        <p className="connection-settings-form__success" role="status">
          設定を保存しました
        </p>
      )}
      <ErrorBanner error={update.error} />

      {test.isSuccess &&
        (test.data.ok ? (
          <p className="connection-settings-form__success" role="status">
            接続に成功しました{test.data.auth === "none" ? "（認証なし）" : "（Bearer 認証）"}
          </p>
        ) : (
          <p className="connection-settings-form__test-error" role="alert">
            接続に失敗しました: {test.data.error}
          </p>
        ))}
      <ErrorBanner error={test.error} />
    </form>
  );
}
