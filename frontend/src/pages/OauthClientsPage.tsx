import { useState } from "react";
import { Link } from "react-router-dom";
import type { OauthClientCreated } from "../api/adminClient";
import { useOauthClients } from "../api/adminQueries";
import { ClientSecretModal } from "../components/ClientSecretModal";
import { ErrorBanner } from "../components/ErrorBanner";
import { OauthClientCreateForm } from "../components/OauthClientCreateForm";
import { OauthClientTable } from "../components/OauthClientTable";

export function OauthClientsPage() {
  const { data, isLoading, error } = useOauthClients();
  const [showForm, setShowForm] = useState(false);
  const [created, setCreated] = useState<OauthClientCreated | null>(null);

  return (
    <div className="page">
      <div className="page__header">
        <h1>OAuth クライアント</h1>
        {!showForm && (
          <button type="button" onClick={() => setShowForm(true)}>
            新規登録
          </button>
        )}
      </div>
      <p className="oauth-clients__lead">
        上流 FHIR サーバーに登録された OAuth クライアントを管理します。登録には
        <Link to="/settings">接続設定</Link>の「FHIR 管理トークン」が必要です。
        上流がスリープ中の場合、初回の表示は最大90秒ほどかかることがあります。
      </p>

      {showForm && (
        <OauthClientCreateForm
          onCreated={(client) => {
            setShowForm(false);
            setCreated(client);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {isLoading && <p>読み込み中...</p>}
      <ErrorBanner error={error} />
      {data && <OauthClientTable clients={data} />}

      {created && <ClientSecretModal client={created} onClose={() => setCreated(null)} />}
    </div>
  );
}
