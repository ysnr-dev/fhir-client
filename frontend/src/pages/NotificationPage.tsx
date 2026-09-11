import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useCompleteNotifications, useNotifications } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientKana } from "../components/PatientRowCells";
import {
  NOTIFICATION_KINDS,
  type NotificationRow,
} from "../components/notifications/notificationRegistry";
import {
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_SEVERITY_LABEL,
  notificationSeverityOf,
  type NotificationSeverity,
} from "../fhir/notificationHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { useNotificationPolling } from "../hooks/useNotificationPolling";
import { dateTimeSecondsLabel } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 通知(診療業務)。
//
// 宛先の決まった未対応の通知を 1 つの一覧にまとめる。いまの種別は緊急異常値(検査結果を
// 見てほしい)とオーダー承認(代行入力を承認してほしい)で、読影の重要所見や文書作成の督促が
// 今後ここに並ぶ。種別ごとの内容セルと操作は notificationRegistry が持つ。
//
// 種別と強度(アラート / 注意 / お知らせ)で絞れる。どちらの件数も絞り込む前の全件から
// 数えるので、2 つのセレクトは互いに独立した軸として読める。並びは通知日時の新しい順で、
// 強度では並べ替えない(いつ届いたかが分からなくなるため)。
//
// 既定は自分あてだけ。宛先の決まらない通知(オーダーに紐付かない検査結果など)は
// 「すべて」に切り替えると出る(検査室が電話連絡する運用ならこちらを見る)。
//
// 内容の確認はカルテで行う(種別ごとの詳細表示をここに複製しない)。ここから直接
// 対応済みにするのは、内容を既に把握している場合の近道。

export function NotificationPage() {
  const { practitionerId } = useCurrentPractitioner();
  const [mine, setMine] = useState(true);
  const [kindCode, setKindCode] = useState("");
  const [severity, setSeverity] = useState<NotificationSeverity | "">("");
  const notifications = useNotifications(mine ? practitionerId : undefined);
  const complete = useCompleteNotifications();
  const linkState = useReturnLinkState();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [polling, setPolling] = useNotificationPolling();

  // 医療従事者に紐付かないアカウントでは自分あてが決まらないので、すべてを出す。
  useEffect(() => {
    if (!practitionerId) setMine(false);
  }, [practitionerId]);

  // 列を折り返さないぶん幅が要る(オーダー承認・検体検査一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const allRows = useMemo(() => notifications.data ?? [], [notifications.data]);
  const rows = useMemo(
    () =>
      allRows.filter(
        (row) =>
          (!kindCode || row.kind.code === kindCode) &&
          (!severity || notificationSeverityOf(row.row.task) === severity),
      ),
    [allRows, kindCode, severity],
  );
  // 種別ごとの件数。フィルタの選択肢に添えて、どこに溜まっているかを一目で分かるようにする。
  const countByKind = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of allRows) counts.set(row.kind.code, (counts.get(row.kind.code) ?? 0) + 1);
    return counts;
  }, [allRows]);
  const countBySeverity = useMemo(() => {
    const counts = new Map<NotificationSeverity, number>();
    for (const row of allRows) {
      const value = notificationSeverityOf(row.row.task);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  }, [allRows]);

  // 読み直しで消えた行(対応済み)は選択から外す。
  const selected = rows.filter((row) => selectedIds.has(row.row.task.id ?? ""));
  // 自分が対応できないもの(他人あての承認)は一括操作の対象にしない。
  const actionable = rows.filter((row) => canAct(row, practitionerId));

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(
      selected.length === actionable.length
        ? new Set()
        : new Set(actionable.map((row) => row.row.task.id ?? "")),
    );
  }

  function completeRows(target: NotificationRow[]) {
    complete.mutate(target, { onSuccess: () => setSelectedIds(new Set()) });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>通知</h1>
        <div className="page__header-actions notification__actions-bar">
          <select
            className="notification__severity-select"
            value={severity}
            onChange={(event) => setSeverity(event.target.value as NotificationSeverity | "")}
            aria-label="強度"
          >
            <option value="">すべての強度（{allRows.length}）</option>
            {NOTIFICATION_SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {NOTIFICATION_SEVERITY_LABEL[value]}（{countBySeverity.get(value) ?? 0}）
              </option>
            ))}
          </select>
          <select
            className="notification__kind-select"
            value={kindCode}
            onChange={(event) => setKindCode(event.target.value)}
            aria-label="種別"
          >
            <option value="">すべての種別（{allRows.length}）</option>
            {NOTIFICATION_KINDS.map((kind) => (
              <option key={kind.code} value={kind.code}>
                {kind.label}（{countByKind.get(kind.code) ?? 0}）
              </option>
            ))}
          </select>
          <label className="notification__filter">
            <input
              type="checkbox"
              checked={mine}
              disabled={!practitionerId}
              onChange={(event) => setMine(event.target.checked)}
            />
            自分あてのみ
          </label>
          {/* ヘッダーのベルの件数を自動で追いかけるかどうか。上流は検索のたびに監査ログを
              1 行書くので、常に見張りたい端末でだけ入れる(readme「通知(Task)」)。 */}
          <label className="notification__filter" title="ヘッダーの通知件数を 1 分ごとに読み直します">
            <input
              type="checkbox"
              checked={polling}
              onChange={(event) => setPolling(event.target.checked)}
            />
            自動更新
          </label>
          <button
            type="button"
            className="button"
            disabled={selected.length === 0 || complete.isPending}
            onClick={() => completeRows(selected)}
          >
            選択を対応済みにする{selected.length > 0 ? `（${selected.length} 件）` : ""}
          </button>
        </div>
      </div>

      <ErrorBanner error={notifications.error} />
      <ErrorBanner error={complete.error} />

      {!practitionerId && (
        <p className="order-select__muted">
          医療従事者に紐付いたアカウントでログインすると、自分あての通知だけに絞れます。
        </p>
      )}

      <div className="notification__table-wrap">
        <table className="master-search__table notification">
          <thead>
            <tr>
              <th className="notification__compact">
                <input
                  type="checkbox"
                  aria-label="すべて選択"
                  checked={actionable.length > 0 && selected.length === actionable.length}
                  disabled={actionable.length === 0}
                  onChange={toggleAll}
                />
              </th>
              <th className="notification__compact">通知日時</th>
              <th className="notification__compact">強度</th>
              <th className="notification__compact">種別</th>
              <th className="notification__compact">患者番号</th>
              <th>氏名</th>
              <th className="notification__compact">対象日</th>
              <th>内容</th>
              <th>宛先</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <NotificationTableRow
                key={entry.row.task.id}
                entry={entry}
                checked={selectedIds.has(entry.row.task.id ?? "")}
                actionable={canAct(entry, practitionerId)}
                pending={complete.isPending}
                linkState={linkState}
                onToggle={() => toggle(entry.row.task.id ?? "")}
                onComplete={() => completeRows([entry])}
              />
            ))}
            {!notifications.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="master-search__empty">
                  未対応の通知はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function canAct(entry: NotificationRow, practitionerId: string | null): boolean {
  return entry.kind.canAct ? entry.kind.canAct(entry.row, practitionerId) : true;
}

interface NotificationTableRowProps {
  entry: NotificationRow;
  checked: boolean;
  actionable: boolean;
  pending: boolean;
  linkState: ReturnType<typeof useReturnLinkState>;
  onToggle: () => void;
  onComplete: () => void;
}

function NotificationTableRow({
  entry,
  checked,
  actionable,
  pending,
  linkState,
  onToggle,
  onComplete,
}: NotificationTableRowProps) {
  const { kind, row } = entry;
  const karteLink = kind.karteLink(row);
  const severity = notificationSeverityOf(row.task);

  return (
    <tr className={severity === "alert" ? "notification__row--alert" : undefined}>
      <td className="notification__compact">
        <input
          type="checkbox"
          checked={checked}
          disabled={!actionable}
          onChange={onToggle}
          aria-label="選択"
        />
      </td>
      <td className="notification__compact">{dateTimeSecondsLabel(row.authoredOn)}</td>
      <td className="notification__compact">
        <span className={`notification__severity notification__severity--${severity}`}>
          {NOTIFICATION_SEVERITY_LABEL[severity]}
        </span>
      </td>
      <td className="notification__compact">{kind.label}</td>
      <td className="notification__compact">{row.patient ? patientNumberOf(row.patient) : ""}</td>
      <td>
        {row.patient ? (
          <>
            {displayName(row.patient)}
            <PatientKana patient={row.patient} />
          </>
        ) : (
          row.patientId
        )}
      </td>
      <kind.Cells row={row} />
      <td>{row.ownerName || "(宛先なし)"}</td>
      <td className="master-search__actions notification__actions">
        {karteLink && (
          <Link className="button" to={karteLink} state={linkState}>
            カルテ
          </Link>
        )}
        {actionable && (
          <button type="button" disabled={pending} onClick={onComplete}>
            {kind.action.label}
          </button>
        )}
      </td>
    </tr>
  );
}
