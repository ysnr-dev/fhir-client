import { useState } from "react";
import { useAdminLogin } from "../api/adminQueries";
import { ErrorBanner } from "../components/ErrorBanner";

export function AdminLoginPage() {
  const [token, setToken] = useState("");
  const login = useAdminLogin();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    login.mutate(token, { onSuccess: () => setToken("") });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>管理画面ログイン</h1>
      </div>
      <p className="admin-login__lead">
        この画面は接続設定と OAuth クライアントの管理に使います。サーバーに設定された管理パスフレーズ
        (<code>ADMIN_TOKEN</code>)を入力してください。
      </p>
      <form className="admin-login-form" onSubmit={handleSubmit}>
        <label>
          管理パスフレーズ
          <input
            type="password"
            value={token}
            autoComplete="current-password"
            autoFocus
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <button type="submit" disabled={!token || login.isPending}>
          {login.isPending ? "確認中..." : "ログイン"}
        </button>
        <ErrorBanner error={login.error} />
      </form>
    </div>
  );
}
