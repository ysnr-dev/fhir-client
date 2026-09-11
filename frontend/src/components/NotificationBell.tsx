import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useNotificationCount } from "../api/queries";
import { useNotificationPolling } from "../hooks/useNotificationPolling";

/**
 * ヘッダーの通知ベル。ログイン中の医療従事者あての未対応件数を常に出す
 * (緊急異常値は連絡が遅れると患者に害が出るので、メニューを開かないと気付けない
 * 置き方にしない)。医療従事者に紐付かないアカウントでは宛先で絞れないので全件。
 *
 * 自動更新の入り切りは通知一覧に置く(ヘッダーは常に見えているぶん、置くものを
 * 件数だけに絞る)。切っている間も、ページを移るたびと、ウィンドウに戻ったときに
 * 読み直す。通知が増える書き込み(結果登録・オーダーの登録や編集)と対応済みの操作は
 * invalidate で即座に反映される。
 */
export function NotificationBell() {
  const { practitionerId } = useCurrentPractitioner();
  const [polling] = useNotificationPolling();
  const count = useNotificationCount(practitionerId, polling);
  const location = useLocation();

  // ベルは常に画面に居るので、react-query のマウント時再取得が効かない。
  // 画面を移ったときを「区切り」とみなして、古くなっていれば読み直す。
  const { refetch, isStale } = count;
  useEffect(() => {
    if (isStale) refetch();
    // 画面を移ったときだけ見る(isStale の変化で引き直すと実質ポーリングになる)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // 件数が取れないとき(上流が落ちている・権限が無い)は数字を出さない。ベルは残す。
  const total = count.data ?? 0;

  return (
    <Link
      to="/notifications"
      className={`notification-bell${total > 0 ? " notification-bell--unread" : ""}`}
      aria-label={total > 0 ? `通知 未対応 ${total} 件` : "通知"}
      title={total > 0 ? `未対応の通知 ${total} 件` : "通知"}
    >
      <svg className="notification-bell__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M12 2.75a5.75 5.75 0 0 0-5.75 5.75v3.36L4.6 15.4a.6.6 0 0 0 .53.9h13.74a.6.6 0 0 0 .53-.9l-1.65-3.54V8.5A5.75 5.75 0 0 0 12 2.75Z"
          fill="currentColor"
        />
        <path
          d="M9.5 18.6a2.5 2.5 0 0 0 5 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      {total > 0 && <span className="notification-bell__count">{total}</span>}
    </Link>
  );
}
