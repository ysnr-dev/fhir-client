import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { usePanicResults } from "../api/queries";

/**
 * 診療業務メニューの「緊急異常値」。ログイン中の医師あての未確認件数を添える
 * (パニック値は連絡が遅れると患者に害が出るので、メニューを開くたびに目に入れる)。
 * 件数の取得は一覧と同じクエリ(staleTime 60 秒)なので、一覧を開いても二重には走らない。
 */
export function LabPanicNavLink() {
  const { practitionerId } = useCurrentPractitioner();
  const panic = usePanicResults(practitionerId);
  const count = panic.data?.length ?? 0;

  return (
    <Link to="/lab-panic-results" className="row-menu__item">
      緊急異常値{count > 0 ? `（${count}）` : ""}
    </Link>
  );
}
