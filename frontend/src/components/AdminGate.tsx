import type { ReactNode } from "react";
import { AdminApiError } from "../api/adminClient";
import { useAdminSession, useAdminLogout } from "../api/adminQueries";
import { AdminLoginPage } from "../pages/AdminLoginPage";
import { ErrorBanner } from "./ErrorBanner";

// 管理画面のログインゲート。
//
// /admin 配下のどこかで 401 が出ると main.tsx のハンドラがセッションクエリを
// invalidate する。refetch で authenticated が false に反転し、ゲートされた
// 全ページがログイン画面へ切り替わる。ADMIN_TOKEN 未設定のサーバーでは
// authenticated が常に true なので、ログイン画面は出ない。
export function AdminGate({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useAdminSession();

  if (isLoading) return <p className="page">読み込み中...</p>;
  if (error) {
    // フロントエンドと backend は Render 上で別サービスとして独立にデプロイされる。
    // 先にフロントだけが入れ替わると /admin/session が存在せず 404 になるので、
    // 素の「HTTP 404」ではなく原因を名指しする。
    const staleBackend = error instanceof AdminApiError && error.status === 404;
    return (
      <div className="page">
        {staleBackend ? (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">
              管理APIが見つかりません (HTTP 404)。backend
              のデプロイがまだ完了していない可能性があります。
            </p>
          </div>
        ) : (
          <ErrorBanner error={error} />
        )}
      </div>
    );
  }
  if (data && !data.authenticated) return <AdminLoginPage />;

  return (
    <>
      {data?.auth_required && <AdminLogoutBar />}
      {children}
    </>
  );
}

function AdminLogoutBar() {
  const logout = useAdminLogout();

  return (
    <div className="admin-session-bar">
      <span className="admin-session-bar__status">管理者としてログイン中</span>
      <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
        {logout.isPending ? "ログアウト中..." : "ログアウト"}
      </button>
    </div>
  );
}
