import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useChangeReferralStatus,
  useReferralRows,
  useReferralStatsRows,
  useSelfDepartments,
  useUndoReferralReply,
  type ReferralStatusFilter,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { OrganizationSearchModal } from "../components/OrganizationSearchModal";
import { PatientKana } from "../components/PatientRowCells";
import { ReferralFormModal, ReferralReplyModal, ReferralVisitModal } from "../components/ReferralModals";
import { RowMenu } from "../components/RowMenu";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { departmentDisplayName } from "../fhir/departmentHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import {
  percentLabel,
  REFERRAL_REPLY_OVERDUE_DAYS,
  REFERRAL_STATUS_LABEL,
  referralStatsOf,
  replyKindDisplay,
  type ReferralDirection,
  type ReferralRow,
} from "../fhir/referralHelpers";
import { addMonths, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 地域連携(部門業務。docs/referral-design.md)。
//
//   紹介受 … 他院から受けた紹介。受診と、紹介元への返書(受診報告・中間報告・最終報告)を記録する
//   紹介   … 他院へ出した紹介・逆紹介・転院。紹介先からの返書の受領を記録する
//   集計   … 期間内の件数、紹介率・逆紹介率、連携先ごとの内訳

type Tab = ReferralDirection | "stats";

const TABS: { key: Tab; label: string }[] = [
  { key: "inbound", label: "紹介受" },
  { key: "outbound", label: "紹介" },
  { key: "stats", label: "集計" },
];

const STATUS_OPTIONS: { value: ReferralStatusFilter; label: string }[] = [
  { value: "active", label: "進行中" },
  { value: "completed", label: "完了" },
  { value: "revoked", label: "取消" },
  { value: "", label: "すべて" },
];

/** 一覧の期間の既定(紹介日がこの月数より前の進行中は期間を広げて探す)。 */
const DEFAULT_LIST_MONTHS = 3;

export function ReferralPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === searchParams.get("tab"))?.key ?? "inbound") as Tab;

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  return (
    <div className="page">
      <div className="page__header">
        <h1>地域連携</h1>
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

      {tab === "stats" ? <StatsTab /> : <ListTab key={tab} direction={tab} />}
    </div>
  );
}

function DepartmentSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { departments } = useSelfDepartments();
  return (
    <label>
      診療科
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">すべて</option>
        {departments.map((department) => (
          <option key={department.id} value={department.id}>
            {departmentDisplayName(department)}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---- 紹介受・紹介 ----

function ListTab({ direction }: { direction: ReferralDirection }) {
  const inbound = direction === "inbound";
  const [from, setFrom] = useState(() => addMonths(today(), -DEFAULT_LIST_MONTHS));
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<ReferralStatusFilter>("active");
  const [departmentId, setDepartmentId] = useState("");
  const [partner, setPartner] = useState<{ id: string; name: string } | null>(null);
  const [pickingPartner, setPickingPartner] = useState(false);

  const query = useReferralRows({
    direction,
    from,
    to,
    status,
    partnerOrganizationId: partner?.id ?? "",
    departmentId,
  });
  const changeStatus = useChangeReferralStatus();
  const undoReply = useUndoReferralReply();
  const linkState = useReturnLinkState();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ReferralRow | null>(null);
  const [visiting, setVisiting] = useState<ReferralRow | null>(null);
  const [replying, setReplying] = useState<ReferralRow | null>(null);

  const rows = query.data?.rows ?? [];
  const pending = changeStatus.isPending || undoReply.isPending;
  const partnerLabel = inbound ? "紹介元" : "紹介先";

  return (
    <>
      <div className="patient-search-form referral__filters">
        <label>
          紹介日
          <span className="referral__range">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="紹介日(開始)" />
            〜
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="紹介日(終了)" />
          </span>
        </label>
        <label>
          状態
          <select value={status} onChange={(e) => setStatus(e.target.value as ReferralStatusFilter)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <DepartmentSelect value={departmentId} onChange={setDepartmentId} />
        <label>
          {partnerLabel}
          <span className="referral__partner-row">
            <input type="text" value={partner?.name ?? ""} placeholder="すべて" readOnly />
            <button type="button" onClick={() => setPickingPartner(true)}>
              選択
            </button>
            {partner && (
              <button type="button" onClick={() => setPartner(null)}>
                解除
              </button>
            )}
          </span>
        </label>
        <div className="patient-search-form__actions referral__create">
          <button type="button" onClick={() => setCreating(true)}>
            登録
          </button>
        </div>
      </div>

      <ErrorBanner error={query.error} />
      <ErrorBanner error={changeStatus.error ?? undoReply.error} />
      <TruncatedNotice show={query.data?.truncated} />

      <div className="notification__table-wrap">
        <table className="master-search__table notification">
          <thead>
            <tr>
              <th className="notification__compact">紹介日</th>
              <th className="notification__compact">患者番号</th>
              <th>氏名</th>
              <th className="notification__compact">区分</th>
              <th>{partnerLabel}</th>
              <th>診療科</th>
              <th>担当医</th>
              <th className="notification__content">紹介目的</th>
              <th className="notification__compact">受診予定</th>
              {inbound && <th className="notification__compact">受診日</th>}
              <th>返書</th>
              <th className="notification__compact">状態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="notification__compact">{row.referralDate}</td>
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
                <td className="notification__compact">{row.kindLabel}</td>
                <td>
                  {row.partnerOrganizationName}
                  {row.partnerPractitionerName && (
                    <div className="result-followup__memo">{row.partnerPractitionerName}</div>
                  )}
                </td>
                <td>{row.departmentName}</td>
                <td>{row.practitionerName}</td>
                <td className="notification__content">
                  {row.purpose}
                  {row.documentName && <div className="result-followup__memo">{row.documentName}</div>}
                  {row.comment && <div className="result-followup__memo">{row.comment}</div>}
                </td>
                <td className="notification__compact">{row.plannedDate}</td>
                {inbound && <td className="notification__compact">{row.visitDate}</td>}
                <td>
                  {row.replies.map((reply, index) => (
                    <div key={index} className="referral__reply" title={reply.note || undefined}>
                      {reply.date} {replyKindDisplay(row.direction, reply.kind)}
                    </div>
                  ))}
                </td>
                <td className="notification__compact">
                  {REFERRAL_STATUS_LABEL[row.status]}
                  {row.waitingDays !== null && row.waitingDays > REFERRAL_REPLY_OVERDUE_DAYS && (
                    <span className="notification__overdue"> {row.waitingDays} 日</span>
                  )}
                </td>
                <td className="master-search__actions referral__actions">
                  {row.patientId && (
                    <Link className="button" to={`/patients/${row.patientId}/karte`} state={linkState}>
                      カルテ
                    </Link>
                  )}
                  {row.status === "waiting" && (
                    <button type="button" onClick={() => setVisiting(row)}>
                      受診
                    </button>
                  )}
                  {row.status === "reply-pending" && (
                    <button type="button" onClick={() => setReplying(row)}>
                      返書
                    </button>
                  )}
                  <RowMenu label="この紹介の操作" escapesClipping>
                    <button type="button" role="menuitem" className="row-menu__item" onClick={() => setEditing(row)}>
                      編集
                    </button>
                    {inbound && row.visitDate && row.status !== "revoked" && (
                      <button type="button" role="menuitem" className="row-menu__item" onClick={() => setVisiting(row)}>
                        受診日変更
                      </button>
                    )}
                    {row.replies.length > 0 && (
                      <button
                        type="button"
                        role="menuitem"
                        className="row-menu__item"
                        disabled={pending}
                        onClick={() => undoReply.mutate(row)}
                      >
                        返書取消
                      </button>
                    )}
                    {row.status === "reply-pending" && (
                      <button
                        type="button"
                        role="menuitem"
                        className="row-menu__item"
                        disabled={pending}
                        onClick={() => changeStatus.mutate({ row, status: "completed" })}
                      >
                        完了
                      </button>
                    )}
                    {(row.status === "completed" || row.status === "revoked") && (
                      <button
                        type="button"
                        role="menuitem"
                        className="row-menu__item"
                        disabled={pending}
                        onClick={() => changeStatus.mutate({ row, status: "active" })}
                      >
                        進行中に戻す
                      </button>
                    )}
                    {(row.status === "waiting" || row.status === "reply-pending") && (
                      <button
                        type="button"
                        role="menuitem"
                        className="row-menu__item row-menu__item--danger"
                        disabled={pending}
                        onClick={() => changeStatus.mutate({ row, status: "revoked" })}
                      >
                        取消
                      </button>
                    )}
                  </RowMenu>
                </td>
              </tr>
            ))}
            {!query.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={13} className="master-search__empty">
                  該当する紹介はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && <ReferralFormModal direction={direction} onClose={() => setCreating(false)} />}
      {editing && <ReferralFormModal direction={direction} row={editing} onClose={() => setEditing(null)} />}
      {visiting && <ReferralVisitModal row={visiting} onClose={() => setVisiting(null)} />}
      {replying && <ReferralReplyModal row={replying} onClose={() => setReplying(null)} />}
      {pickingPartner && (
        <OrganizationSearchModal
          excludeSelf
          title={`${partnerLabel}を選択`}
          onClose={() => setPickingPartner(false)}
          onSelect={(organization) => {
            setPartner({ id: organization.id ?? "", name: organizationDisplayName(organization) });
            setPickingPartner(false);
          }}
        />
      )}
    </>
  );
}

// ---- 集計 ----

function StatsTab() {
  const [from, setFrom] = useState(() => `${today().slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [departmentId, setDepartmentId] = useState("");
  const [firstVisits, setFirstVisits] = useState("");
  const query = useReferralStatsRows(from, to, departmentId);
  const stats = useMemo(() => referralStatsOf(query.data ?? []), [query.data]);
  const denominator = Number(firstVisits) > 0 ? Number(firstVisits) : 0;

  const tiles: { label: string; value: string }[] = [
    { label: "紹介受", value: String(stats.inbound) },
    { label: "紹介", value: String(stats.outbound) },
    { label: "うち逆紹介", value: String(stats.counterReferral) },
    { label: "紹介率", value: percentLabel(stats.inbound, denominator) || "-" },
    { label: "逆紹介率", value: percentLabel(stats.counterReferral, denominator) || "-" },
    { label: "返書率", value: percentLabel(stats.inboundReplied, stats.inboundVisited) || "-" },
    { label: `返書待ち ${REFERRAL_REPLY_OVERDUE_DAYS} 日超`, value: String(stats.replyOverdue) },
  ];

  return (
    <>
      <div className="patient-search-form referral__filters">
        <label>
          紹介日
          <span className="referral__range">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="紹介日(開始)" />
            〜
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="紹介日(終了)" />
          </span>
        </label>
        <DepartmentSelect value={departmentId} onChange={setDepartmentId} />
        <label>
          初診患者数
          <input
            type="number"
            min={0}
            className="referral__count-input"
            value={firstVisits}
            onChange={(e) => setFirstVisits(e.target.value)}
          />
        </label>
      </div>

      <ErrorBanner error={query.error} />

      <div className="referral__tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="referral__tile">
            <div className="referral__tile-label">{tile.label}</div>
            <div className="referral__tile-value">{tile.value}</div>
          </div>
        ))}
      </div>

      <div className="notification__table-wrap">
        <table className="master-search__table notification">
          <thead>
            <tr>
              <th>連携先</th>
              <th className="referral__number">紹介受</th>
              <th className="referral__number">紹介</th>
              <th className="referral__number">うち逆紹介</th>
            </tr>
          </thead>
          <tbody>
            {stats.partners.map((partner) => (
              <tr key={partner.organizationId}>
                <td>{partner.organizationName || partner.organizationId}</td>
                <td className="referral__number">{partner.inbound}</td>
                <td className="referral__number">{partner.outbound}</td>
                <td className="referral__number">{partner.counterReferral}</td>
              </tr>
            ))}
            {!query.isLoading && stats.partners.length === 0 && (
              <tr>
                <td colSpan={4} className="master-search__empty">
                  該当する紹介はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
