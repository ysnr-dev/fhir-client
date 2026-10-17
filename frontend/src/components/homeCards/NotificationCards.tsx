import { useEffect } from "react";
import { Link } from "react-router-dom";
import { DOCUMENT_DUE_TASK_CODE, type DocumentDueRow } from "../../fhir/documentDueHelpers";
import { NOTE_COUNTERSIGN_TASK_CODE } from "../../fhir/countersignHelpers";
import { NOTIFICATION_SEVERITY_LABEL, notificationSeverityOf } from "../../fhir/notificationHelpers";
import { ORDER_APPROVAL_TASK_CODE } from "../../fhir/orderApprovalTaskHelpers";
import { displayName, patientNumberOf } from "../../fhir/patientHelpers";
import { dateTimeSecondsLabel } from "../../lib/dates";
import { useReturnLinkState } from "../../returnTo";
import { ErrorBanner } from "../ErrorBanner";
import { useNotificationRows } from "../notifications/notificationQueries";
import type { NotificationRow } from "../notifications/notificationRegistry";
import { HomeCardFrame, HomeCardLoading, type HomeCardProps } from "./shared";

// 自分宛ての未対応の Task(通知)を出すカード。通知カードは全種別、カウンターサイン待ちと
// 期限のある書類は同じ検索結果を種別で絞るだけなので、上流の読み込みは増えない。

const NOTIFICATION_ROWS = 5;

/** 未対応の通知(全種別)。 */
export function NotificationCard({ practitionerId }: HomeCardProps<"notifications">) {
  return <NotificationTableCard title="未対応の通知" link="/notifications" practitionerId={practitionerId} />;
}

const COUNTERSIGN_CODES = [NOTE_COUNTERSIGN_TASK_CODE.code, ORDER_APPROVAL_TASK_CODE.code];

/** 自分が承認する記録・代行入力。 */
export function CountersignsCard({ practitionerId }: HomeCardProps<"countersigns">) {
  return (
    <NotificationTableCard
      title="カウンターサイン待ち"
      link="/countersigns"
      practitionerId={practitionerId}
      codes={COUNTERSIGN_CODES}
      emptyText="承認待ちの記録はありません。"
    />
  );
}

/** 退院時サマリーなど期限のある書類。期限を過ぎた件数を添える。 */
export function DocumentsDueCard({ practitionerId }: HomeCardProps<"documentsDue">) {
  return (
    <NotificationTableCard
      title="期限のある書類"
      link="/admission-documents"
      practitionerId={practitionerId}
      codes={[DOCUMENT_DUE_TASK_CODE.code]}
      emptyText="作成待ちの書類はありません。"
      secondary={{
        label: "期限超過",
        count: (rows) => rows.filter((entry) => (entry.row as DocumentDueRow).overdueDays > 0).length,
      }}
    />
  );
}

function NotificationTableCard({
  title,
  link,
  practitionerId,
  codes,
  emptyText = "未対応の通知はありません。",
  secondary,
}: {
  title: string;
  link: string;
  practitionerId: string | null;
  /** 絞る種別(Task.code)。省略すると全種別。 */
  codes?: readonly string[];
  emptyText?: string;
  /** 大きな数字の隣に出す補足件数。省略するとアラートの件数。 */
  secondary?: { label: string; count: (rows: NotificationRow[]) => number };
}) {
  const notifications = useNotificationRows(practitionerId);
  const linkState = useReturnLinkState();

  // 一覧と同じ 60 秒のキャッシュに乗るので、開いたときに古ければ読み直す。
  const { isStale, refetch } = notifications;
  useEffect(() => {
    if (isStale) refetch();
    // 開いたときに一度だけ(isStale の変化で引き直すと実質ポーリングになる)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = notifications.data ?? [];
  const rows = codes ? all.filter((entry) => codes.includes(entry.kind.code)) : all;
  const secondaryCount = secondary
    ? secondary.count(rows)
    : rows.filter((entry) => notificationSeverityOf(entry.row.task) === "alert").length;
  const secondaryLabel = secondary?.label ?? "アラート";

  return (
    <HomeCardFrame title={title} link={{ to: link, label: "すべて見る" }}>
      <ErrorBanner error={notifications.error} />
      {notifications.isPending ? (
        <HomeCardLoading />
      ) : (
        <>
          <p className="home__counts">
            <span className={`home__count home__count--big${secondaryCount > 0 ? " home__count--alert" : ""}`}>
              未対応 <strong>{rows.length}</strong>
            </span>
            {secondaryCount > 0 && (
              <span className="home__count">
                {secondaryLabel} <strong>{secondaryCount}</strong>
              </span>
            )}
          </p>
          {rows.length === 0 ? (
            <p className="home__empty">{emptyText}</p>
          ) : (
            <div className="home__table-wrap">
              <table className="home__table">
                <thead>
                  <tr>
                    <th>強度</th>
                    <th>種別</th>
                    <th>患者番号</th>
                    <th>患者氏名</th>
                    <th>通知日時</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, NOTIFICATION_ROWS).map((entry) => (
                    <NotificationLine key={entry.row.task.id} entry={entry} linkState={linkState} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > NOTIFICATION_ROWS && (
            <p className="home__more">
              <Link to={link}>他 {rows.length - NOTIFICATION_ROWS} 件</Link>
            </p>
          )}
        </>
      )}
    </HomeCardFrame>
  );
}

function NotificationLine({
  entry,
  linkState,
}: {
  entry: NotificationRow;
  linkState: ReturnType<typeof useReturnLinkState>;
}) {
  const { kind, row } = entry;
  const severity = notificationSeverityOf(row.task);
  const karteLink = kind.karteLink(row);
  const name = row.patient ? displayName(row.patient) : row.patientId;
  return (
    <tr className={severity === "alert" ? "notification__row--alert" : undefined}>
      <td className="home__cell-compact">
        <span className={`notification__severity notification__severity--${severity}`}>
          {NOTIFICATION_SEVERITY_LABEL[severity]}
        </span>
      </td>
      <td className="home__cell-compact">{kind.label}</td>
      <td className="home__cell-compact">{row.patient ? patientNumberOf(row.patient) : ""}</td>
      <td>
        {karteLink ? (
          <Link className="home__row-link" to={karteLink} state={linkState}>
            {name}
          </Link>
        ) : (
          name
        )}
      </td>
      <td className="home__cell-compact">{dateTimeSecondsLabel(row.authoredOn)}</td>
    </tr>
  );
}
