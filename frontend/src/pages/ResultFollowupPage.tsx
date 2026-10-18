import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useFollowUpOrderCandidates,
  useFollowUpRows,
  useReopenFollowUp,
  useResolveFollowUp,
  useStaleResultRows,
  type FollowUpStatusFilter,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { PatientKana } from "../components/PatientRowCells";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { notificationRows, type NotificationRow } from "../components/notifications/notificationRegistry";
import {
  DEFAULT_STALE_RESULT_DAYS,
  FOLLOW_UP_RESOLUTIONS,
  FOLLOW_UP_SOON_DAYS,
  STALE_RESULT_DAY_OPTIONS,
  STALE_RESULT_TASK_CODES,
  type FollowUpResolution,
  type FollowUpRow,
} from "../fhir/followUpHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { dateTimeSecondsLabel, diffDays, localDay, today } from "../lib/dates";
import { KARTE_TAB_PARAM } from "../karteUrl";
import { useReturnLinkState } from "../returnTo";

// 検査結果フォロー(診療業務。docs/result-followup-design.md)。
//
//   フォロー推奨   … 検査レポートの「6 か月後に再検」のような推奨を期限の近い順に並べ、対応を記録する
//   未確認の結果   … 通知日から一定の日数が経っても確認されていない検査結果の通知
//
// どちらも既定は自分あて。宛先の決まらないもの(オーダーに紐付かない結果)は外すと出る。

type Tab = "follow-up" | "stale";

const TABS: { key: Tab; label: string }[] = [
  { key: "follow-up", label: "フォロー推奨" },
  { key: "stale", label: "未確認の結果" },
];

export function ResultFollowupPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === searchParams.get("tab"))?.key ?? "follow-up") as Tab;
  const { practitionerId } = useCurrentPractitioner();
  const [mine, setMine] = useState(true);

  useEffect(() => {
    if (!practitionerId) setMine(false);
  }, [practitionerId]);

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const ownerId = mine ? practitionerId : null;

  return (
    <div className="page">
      <div className="page__header">
        <h1>検査結果フォロー</h1>
        <div className="page__header-actions notification__actions-bar">
          <label className="notification__filter">
            <input
              type="checkbox"
              checked={mine}
              disabled={!practitionerId}
              onChange={(event) => setMine(event.target.checked)}
            />
            自分あてのみ
          </label>
        </div>
      </div>

      <div className="order-select__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => setSearchParams({ tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "follow-up" ? <FollowUpTab ownerId={ownerId} /> : <StaleResultTab ownerId={ownerId} />}
    </div>
  );
}

function reportKarteLink(row: FollowUpRow): string | null {
  if (!row.patientId) return null;
  const params = new URLSearchParams();
  if (row.config) params.set(KARTE_TAB_PARAM, row.config.tabKey);
  if (row.reportId) params.set("view", row.reportId);
  return `/patients/${row.patientId}/karte?${params.toString()}`;
}

function PatientCells({ patient, patientId }: { patient?: fhir4.Patient; patientId: string }) {
  return (
    <>
      <td className="notification__compact">{patient ? patientNumberOf(patient) : ""}</td>
      <td>
        {patient ? (
          <>
            {displayName(patient)}
            <PatientKana patient={patient} />
          </>
        ) : (
          patientId
        )}
      </td>
    </>
  );
}

// ---- フォロー推奨 ----

function FollowUpTab({ ownerId }: { ownerId: string | null }) {
  const [status, setStatus] = useState<FollowUpStatusFilter>("requested");
  const query = useFollowUpRows(status, ownerId);
  const reopen = useReopenFollowUp();
  const [resolving, setResolving] = useState<FollowUpRow | null>(null);
  const linkState = useReturnLinkState();
  const rows = query.data?.rows ?? [];
  const open = status === "requested";

  return (
    <>
      <div className="notification__actions-bar result-followup__filters">
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as FollowUpStatusFilter)}
          aria-label="状態"
        >
          <option value="requested">未対応</option>
          <option value="completed">対応済</option>
        </select>
      </div>

      <ErrorBanner error={query.error} />
      <ErrorBanner error={reopen.error} />
      <TruncatedNotice show={query.data?.truncated} />

      <div className="notification__table-wrap">
        <table className="master-search__table notification">
          <thead>
            <tr>
              <th className="notification__compact">期限</th>
              <th className="notification__compact">患者番号</th>
              <th>氏名</th>
              <th className="notification__compact">検査日</th>
              <th className="notification__compact">種別</th>
              <th>検査内容</th>
              <th className="notification__content">推奨</th>
              {open ? (
                <th>宛先</th>
              ) : (
                <>
                  <th className="notification__compact">対応</th>
                  <th>対応オーダー</th>
                  <th className="notification__compact">対応日</th>
                  <th>対応者</th>
                </>
              )}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const karteLink = reportKarteLink(row);
              return (
                <tr key={row.task.id}>
                  <td className="notification__compact">
                    {row.dueDate || "-"}
                    {open && <DueBadge daysLeft={row.daysLeft} />}
                  </td>
                  <PatientCells patient={row.patient} patientId={row.patientId} />
                  <td className="notification__compact">{row.date}</td>
                  <td className="notification__compact">{row.config?.labels.order ?? ""}</td>
                  <td>{row.exam}</td>
                  <td className="notification__content">
                    {row.recommendation}
                    {row.memo && <div className="result-followup__memo">{row.memo}</div>}
                  </td>
                  {open ? (
                    <td>{row.ownerName || "(宛先なし)"}</td>
                  ) : (
                    <>
                      <td className="notification__compact">{row.resolution}</td>
                      <td>{row.orderLabel}</td>
                      <td className="notification__compact">{row.resolvedAt}</td>
                      <td>{row.resolvedBy}</td>
                    </>
                  )}
                  <td className="master-search__actions notification__actions">
                    {karteLink && (
                      <Link className="button" to={karteLink} state={linkState}>
                        カルテ
                      </Link>
                    )}
                    {open ? (
                      <button type="button" onClick={() => setResolving(row)}>
                        対応
                      </button>
                    ) : (
                      <button type="button" disabled={reopen.isPending} onClick={() => reopen.mutate(row)}>
                        未対応に戻す
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!query.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={12} className="master-search__empty">
                  {open ? "未対応のフォロー推奨はありません" : "対応済みのフォロー推奨はありません"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {resolving && <FollowUpResolveModal row={resolving} onClose={() => setResolving(null)} />}
    </>
  );
}

function DueBadge({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null) return null;
  if (daysLeft < 0) return <span className="notification__overdue"> 超過 {-daysLeft} 日</span>;
  if (daysLeft <= FOLLOW_UP_SOON_DAYS) {
    return <span className="result-followup__soon"> {daysLeft === 0 ? "今日" : `あと ${daysLeft} 日`}</span>;
  }
  return null;
}

function FollowUpResolveModal({ row, onClose }: { row: FollowUpRow; onClose: () => void }) {
  const [resolution, setResolution] = useState<FollowUpResolution>("ordered");
  const [orderId, setOrderId] = useState("");
  const [memo, setMemo] = useState("");
  const candidates = useFollowUpOrderCandidates(row.patientId, row.date);
  const resolve = useResolveFollowUp();
  // 推奨を書いたレポートの元のオーダーは対応にならないので外す。
  const sourceOrderId = row.task.basedOn?.[0]?.reference?.split("/").pop();
  const orders = (candidates.data ?? []).filter((order) => order.id !== sourceOrderId);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const orderLabel = orders.find((o) => o.id === orderId)?.label ?? "";
    resolve.mutate(
      { row, input: { resolution, orderId: resolution === "ordered" ? orderId : "", orderLabel, memo } },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="フォロー推奨の対応" onClose={onClose}>
      <ErrorBanner error={candidates.error} />
      <ErrorBanner error={resolve.error} />
      <dl className="prescription-detail__common">
        <dt>患者</dt>
        <dd>{row.patient ? `${patientNumberOf(row.patient)} ${displayName(row.patient)}` : row.patientId}</dd>
        <dt>検査</dt>
        <dd>{[row.date, row.exam].filter(Boolean).join(" ")}</dd>
        <dt>推奨</dt>
        <dd>
          {row.recommendation}(期限 {row.dueDate})
        </dd>
      </dl>
      <form className="prescription-form" onSubmit={handleSubmit}>
        <fieldset>
          <label>
            対応
            <select value={resolution} onChange={(e) => setResolution(e.target.value as FollowUpResolution)}>
              {FOLLOW_UP_RESOLUTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          {resolution === "ordered" && (
            <label className="result-followup__order">
              対応オーダー
              <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">(選択しない)</option>
                {orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="result-followup__memo-field">
            メモ
            <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>
        </fieldset>
        <div className="prescription-form__submit">
          <button type="submit" disabled={resolve.isPending}>
            {resolve.isPending ? "送信中..." : "登録"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---- 未確認の結果 ----

function StaleResultTab({ ownerId }: { ownerId: string | null }) {
  const [days, setDays] = useState<number>(DEFAULT_STALE_RESULT_DAYS);
  const query = useStaleResultRows(STALE_RESULT_TASK_CODES, days, ownerId, notificationRows);
  const linkState = useReturnLinkState();
  const rows = query.data?.rows ?? [];
  const todayValue = today();

  return (
    <>
      <div className="notification__actions-bar result-followup__filters">
        <select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="経過日数">
          {STALE_RESULT_DAY_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value} 日以上
            </option>
          ))}
        </select>
      </div>

      <ErrorBanner error={query.error} />
      <TruncatedNotice show={query.data?.truncated} />

      <div className="notification__table-wrap">
        <table className="master-search__table notification">
          <thead>
            <tr>
              <th className="notification__compact">通知日時</th>
              <th className="notification__compact">経過</th>
              <th className="notification__compact">種別</th>
              <th className="notification__compact">患者番号</th>
              <th>氏名</th>
              <th className="notification__compact">対象日</th>
              <th className="notification__content">内容</th>
              <th>宛先</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <StaleResultRow key={entry.row.task.id} entry={entry} todayValue={todayValue} linkState={linkState} />
            ))}
            {!query.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="master-search__empty">
                  {days} 日以上未確認の検査結果はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StaleResultRow({
  entry,
  todayValue,
  linkState,
}: {
  entry: NotificationRow;
  todayValue: string;
  linkState: ReturnType<typeof useReturnLinkState>;
}) {
  const { kind, row } = entry;
  const karteLink = kind.karteLink(row);
  return (
    <tr>
      <td className="notification__compact">{dateTimeSecondsLabel(row.authoredOn)}</td>
      <td className="notification__compact">{diffDays(localDay(row.authoredOn), todayValue)} 日</td>
      <td className="notification__compact">{kind.label}</td>
      <PatientCells patient={row.patient} patientId={row.patientId} />
      <kind.Cells row={row} />
      <td>{row.ownerName || "(宛先なし)"}</td>
      <td className="master-search__actions notification__actions">
        {karteLink && (
          <Link className="button" to={karteLink} state={linkState}>
            カルテ
          </Link>
        )}
      </td>
    </tr>
  );
}
