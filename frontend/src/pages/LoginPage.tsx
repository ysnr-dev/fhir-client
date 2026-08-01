import { useState } from "react";
import { useLogin } from "../api/authQueries";
import { ErrorBanner } from "../components/ErrorBanner";

// アプリ本体のログイン画面。医療従事者登録ページで設定したログインID/パスワード、
// または固定ユーザー administrator(パスワードは管理画面ログインと同じ)でログインする。
export function LoginPage() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!loginId || !password) return;
    login.mutate({ loginId, password }, { onSuccess: () => setPassword("") });
  }

  return (
    <div className="page">
      <form className="admin-login-form" onSubmit={handleSubmit}>
        <label>
          ログインID
          <input
            type="text"
            value={loginId}
            autoComplete="username"
            autoFocus
            onChange={(e) => setLoginId(e.target.value)}
          />
        </label>
        <label>
          パスワード
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={!loginId || !password || login.isPending}>
          {login.isPending ? "確認中..." : "ログイン"}
        </button>
        <ErrorBanner error={login.error} />
      </form>
    </div>
  );
}
