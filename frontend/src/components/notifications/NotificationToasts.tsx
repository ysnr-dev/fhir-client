import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  NOTIFICATION_SEVERITY_LABEL,
  notificationSeverityOf,
} from "../../fhir/notificationHelpers";
import { displayName } from "../../fhir/patientHelpers";
import type { NotificationRow } from "./notificationRegistry";

/** 同時に重ねる上限。溢れたら古いものから消す。 */
const MAX_TOASTS = 4;
/** アラート以外が自然に消えるまでの時間。アラートは閉じるまで残す。 */
const AUTO_DISMISS_MS = 10_000;

interface Toast {
  key: string;
  entry: NotificationRow;
}

function lastUpdatedOf(entry: NotificationRow): number {
  const value = entry.row.task.meta?.lastUpdated;
  return value ? Date.parse(value) : 0;
}

/**
 * 新しく届いた通知(作成・出し直し)を画面の隅にトーストで出す。
 *
 * ベルの検索が返す「更新の新しい順の数件」を見て、前回までに見た最も新しい更新日時より
 * 後のものだけを新着とする。開いた直後の 1 回目と宛先が替わった直後は基準を取るだけで出さない。
 * 新着を知るのはベルの件数を読み直したときなので、自動更新を切っている間は画面の移動・
 * ウィンドウへの復帰・通知が増減する書き込みのあとに出る。
 */
export function NotificationToasts({
  latest,
  ownerId,
}: {
  latest: NotificationRow[] | undefined;
  ownerId: string | null | undefined;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const watermark = useRef<{ ownerId: string | null | undefined; time: number } | null>(null);

  useEffect(() => {
    if (!latest) return;
    const newest = Math.max(0, ...latest.map(lastUpdatedOf));
    const base = watermark.current;
    if (!base || base.ownerId !== ownerId) {
      watermark.current = { ownerId, time: newest };
      if (base) setToasts([]);
      return;
    }
    const arrived = latest.filter((entry) => lastUpdatedOf(entry) > base.time);
    if (arrived.length === 0) return;
    watermark.current = { ownerId, time: Math.max(base.time, newest) };
    setToasts((current) => {
      const keys = new Set(arrived.map((entry) => entry.row.task.id));
      const added = [...arrived].reverse().map((entry) => ({
        key: `${entry.row.task.id}/${entry.row.task.meta?.versionId ?? lastUpdatedOf(entry)}`,
        entry,
      }));
      return [...current.filter((toast) => !keys.has(toast.entry.row.task.id)), ...added].slice(
        -MAX_TOASTS,
      );
    });
  }, [latest, ownerId]);

  const dismiss = (key: string) => setToasts((current) => current.filter((toast) => toast.key !== key));

  if (toasts.length === 0) return null;
  // ヘッダー(sticky で重なりの文脈を作る)の中に置くとモーダルの下に隠れるので、body 直下に出す。
  return createPortal(
    <div className="notification-toasts" aria-label="新着の通知">
      {toasts.map((toast) => (
        <NotificationToast key={toast.key} entry={toast.entry} onDismiss={() => dismiss(toast.key)} />
      ))}
    </div>,
    document.body,
  );
}

function NotificationToast({ entry, onDismiss }: { entry: NotificationRow; onDismiss: () => void }) {
  const { kind, row } = entry;
  const severity = notificationSeverityOf(row.task);
  const karteLink = kind.karteLink(row);

  useEffect(() => {
    if (severity === "alert") return;
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
    // 表示した時点から数える(親の描画で onDismiss が作り直されても延ばさない)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity]);

  return (
    <div
      className={`notification-toast notification-toast--${severity}`}
      role={severity === "alert" ? "alert" : "status"}
    >
      <div className="notification-toast__head">
        <span className={`notification__severity notification__severity--${severity}`}>
          {NOTIFICATION_SEVERITY_LABEL[severity]}
        </span>
        <span className="notification-toast__kind">{kind.label}</span>
        <button
          type="button"
          className="notification-toast__close"
          onClick={onDismiss}
          aria-label="閉じる"
          title="閉じる"
        >
          ×
        </button>
      </div>
      <div className="notification-toast__patient">
        {row.patient ? displayName(row.patient) : row.patientId}
      </div>
      {row.task.description && <div className="notification-toast__body">{row.task.description}</div>}
      <div className="notification-toast__actions">
        {karteLink && (
          <Link className="button rp-card__compact-button" to={karteLink} onClick={onDismiss}>
            カルテ
          </Link>
        )}
        <Link className="button rp-card__compact-button" to="/notifications" onClick={onDismiss}>
          一覧
        </Link>
      </div>
    </div>
  );
}
