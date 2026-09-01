import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { usePendingApprovals } from "../api/queries";

/**
 * 診療業務メニューの「オーダー承認」。ログイン中の医師あての承認待ち件数を添える
 * (承認待ちは放置されると真正性の記録として意味を失うので、メニューを開くたびに目に入れる)。
 * 件数の取得は承認待ち一覧と同じクエリ(staleTime 60 秒)なので、一覧を開いても二重には走らない。
 * 医療従事者に紐付かないアカウントでは件数は出ない(承認待ちは author あてにしか無い)。
 */
export function OrderApprovalNavLink() {
  const { practitionerId } = useCurrentPractitioner();
  const pending = usePendingApprovals(practitionerId);
  const count = pending.data?.rows.length ?? 0;

  return (
    <Link to="/order-approvals" className="row-menu__item">
      オーダー承認{count > 0 ? `（${count}）` : ""}
    </Link>
  );
}
