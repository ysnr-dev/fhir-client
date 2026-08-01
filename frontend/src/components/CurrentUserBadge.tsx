import { useAuthSession, useCurrentPractitioner, useLogout } from "../api/authQueries";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";

// ヘッダーに出す「いま誰でログインしているか」+ ログアウト。
// 医療従事者ユーザーは紐付く Practitioner の氏名を、administrator は固定表記を出す。
export function CurrentUserBadge() {
  const { data: session } = useAuthSession();
  const { user, practitioner } = useCurrentPractitioner();
  const logout = useLogout();

  // 認証不要モード(ADMIN_TOKEN 未設定)では何も出さない
  if (!session?.auth_required || !user) return null;

  const name = user.administrator
    ? "管理者"
    : practitioner
      ? practitionerDisplayName(practitioner)
      : user.login_id;

  return (
    <div className="app__user">
      <span className="app__user-name" title={`ログインID: ${user.login_id}`}>
        {name}
      </span>
      <button
        type="button"
        className="app__user-logout"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        {logout.isPending ? "ログアウト中..." : "ログアウト"}
      </button>
    </div>
  );
}
