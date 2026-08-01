import type { ReactNode } from "react";
import { AuthApiError } from "../api/authClient";
import { useAuthSession } from "../api/authQueries";
import { LoginPage } from "../pages/LoginPage";
import { ErrorBanner } from "./ErrorBanner";

// アプリ全体のログインゲート(AdminGate のアプリ本体版)。
//
// どこかの API で 401 が出ると main.tsx のハンドラがセッションクエリを
// invalidate する。refetch で authenticated が false に反転し、アプリ全体が
// ログイン画面へ切り替わる。ADMIN_TOKEN 未設定のサーバーでは authenticated が
// 常に true なので、ログイン画面は出ない(従来どおり認証なしで使える)。
export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useAuthSession();

  if (isLoading) return <p className="page">読み込み中...</p>;
  if (error) {
    // フロントエンドと backend は別サービスとして独立にデプロイされる。先に
    // フロントだけが入れ替わると /auth/session が存在せず 404 になるので、
    // 素の「HTTP 404」ではなく原因を名指しする(AdminGate と同じ配慮)。
    const staleBackend = error instanceof AuthApiError && error.status === 404;
    return (
      <div className="page">
        {staleBackend ? (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">
              ログインAPIが見つかりません (HTTP 404)。backend
              のデプロイがまだ完了していない可能性があります。
            </p>
          </div>
        ) : (
          <ErrorBanner error={error} />
        )}
      </div>
    );
  }
  if (data && !data.authenticated) {
    // 未ログインでは children(App のヘッダー含む)を一切出さず、
    // 最小限のシェルにログイン画面だけを表示する。
    return (
      <div className="app">
        <header className="app__header">
          <span className="app__title">FHIR Client</span>
        </header>
        <main className="app__main">
          <LoginPage />
        </main>
      </div>
    );
  }

  return <>{children}</>;
}
