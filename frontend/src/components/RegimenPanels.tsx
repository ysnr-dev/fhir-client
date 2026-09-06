import { useMemo, useState } from "react";
import {
  useRegimenApplications,
  useRegimenDayOrders,
  useRevokeRegimen,
  useUpdatePrescription,
  useUpdateRegimenDayStatus,
} from "../api/queries";
import { groupInjectionByRp, injectionTimesLabel, injectionUsageSummary } from "../fhir/injectionHelpers";
import { groupByRp } from "../fhir/prescriptionHelpers";
import {
  buildRegimenMoveBundle,
  cycleDayLabel,
  cycleStartDates,
  nextCycleOf,
  regimenDayStatusLabel,
  regimenStatusLabel,
  type RegimenApplication,
  type RegimenDayOrder,
} from "../fhir/regimenOrderHelpers";
import { diffDays } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { RegimenCyclePanel } from "./RegimenApplyPanel";

// カルテ右ペインの、適用済みレジメンに対する操作。
//   RegimenDetailPanel … 適用 1 件(ヘッダ)。クールの一覧、次クールの登録、レジメンの中止
//   RegimenDayPanel    … 暦の 1 日。その日のオーダーの編集・移動・中止
// 暦(KarteChemoTab)は表示に徹し、操作はここに集める。

/** 適用と日オーダーを一緒に読む(両パネルで同じ形)。 */
function useRegimen(patientId: string, regimenSrId: string) {
  const applications = useRegimenApplications(patientId);
  const application = applications.data?.applications.find((a) => a.id === regimenSrId) ?? null;
  const header = applications.data?.headers.find((h) => h.id === regimenSrId) ?? null;
  const earliest = applications.data?.applications.reduce<string | undefined>(
    (min, a) => (min === undefined || a.startDate < min ? a.startDate : min),
    undefined,
  );
  const orders = useRegimenDayOrders(patientId, earliest);
  const own = useMemo(
    () => (orders.data ?? []).filter((o) => o.ref.regimenSrId === regimenSrId),
    [orders.data, regimenSrId],
  );
  return {
    application,
    header,
    orders: own,
    isPending: applications.isPending || (Boolean(earliest) && orders.isPending),
    error: applications.error ?? orders.error,
  };
}

interface RegimenDetailPanelProps {
  patientId: string;
  regimenSrId: string;
  /** 暦の日を右ペインで開く。 */
  onOpenDay: (date: string) => void;
  onSaved: () => void;
}

export function RegimenDetailPanel({ patientId, regimenSrId, onOpenDay, onSaved }: RegimenDetailPanelProps) {
  const { application, header, orders, isPending, error } = useRegimen(patientId, regimenSrId);
  const revoke = useRevokeRegimen();
  // 次クールの登録フォームを開いているか(このパネルの中で切り替える)。
  const [adding, setAdding] = useState(false);

  if (isPending) return <p>読み込み中...</p>;
  if (!application || !header) return <ErrorBanner error={error ?? new Error("レジメンの適用が見つかりません")} />;

  const starts = cycleStartDates(orders);
  const cycles = Array.from(starts.keys()).sort((a, b) => a - b);
  const next = nextCycleOf(application, orders);
  const active = application.status === "active";
  const reachedPlanned = application.plannedCycles !== null && next.cycle > application.plannedCycles;

  if (adding) {
    return (
      <>
        <button type="button" className="order-set-apply__back" onClick={() => setAdding(false)}>
          ← レジメンの詳細
        </button>
        <RegimenCyclePanel
          patientId={patientId}
          application={application}
          cycle={next.cycle}
          startDate={next.startDate}
          onSaved={() => {
            setAdding(false);
            onSaved();
          }}
        />
      </>
    );
  }

  function handleRevoke() {
    if (!header) return;
    const pending = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");
    const message =
      pending.length > 0
        ? `${application?.name} を中止します。未実施の ${pending.length} 件のオーダーも中止になります。よろしいですか？`
        : `${application?.name} を中止します。よろしいですか？`;
    if (!window.confirm(message)) return;
    revoke.mutate({ header, targets: orders }, { onSuccess: onSaved });
  }

  return (
    <div className="regimen-detail">
      <ErrorBanner error={error ?? revoke.error} />
      <dl className="regimen-detail__summary">
        <dt>レジメン</dt>
        <dd>
          {application.name}
          <span className="lab-order-item__code">（{application.code}）</span>
        </dd>
        <dt>状態</dt>
        <dd>
          <span className={`regimen-status regimen-status--${application.status}`}>
            {regimenStatusLabel(application.status)}
          </span>
        </dd>
        <dt>開始日</dt>
        <dd>{application.startDate}</dd>
        <dt>クール</dt>
        <dd>
          {application.cycleDays > 0 ? `${application.cycleDays} 日/クール` : "—"}
          {application.plannedCycles !== null ? ` · 予定 ${application.plannedCycles} クール` : " · 継続"}
        </dd>
        <dt>体格</dt>
        <dd>
          {[
            application.height !== null ? `身長 ${application.height} cm` : "",
            application.weight !== null ? `体重 ${application.weight} kg` : "",
            application.bsa !== null ? `体表面積 ${application.bsa} m²` : "",
          ]
            .filter(Boolean)
            .join(" / ") || "—"}
        </dd>
        {application.problem && (
          <>
            <dt>プロブレム</dt>
            <dd>{application.problem.display}</dd>
          </>
        )}
        {application.comment && (
          <>
            <dt>コメント</dt>
            <dd>{application.comment}</dd>
          </>
        )}
      </dl>

      <table className="master-search__table regimen-detail__cycles">
        <thead>
          <tr>
            <th className="rad-item__compact">クール</th>
            <th className="rad-item__compact">Day 1</th>
            <th>投与日</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((cycle) => {
            const own = orders.filter((o) => o.ref.cycle === cycle);
            const dates = Array.from(new Set(own.map((o) => o.date))).sort();
            return (
              <tr key={cycle}>
                <td className="rad-item__compact">第 {cycle} クール</td>
                <td className="rad-item__compact">{starts.get(cycle)}</td>
                <td className="regimen-detail__days">
                  {dates.map((date) => {
                    const statuses = own.filter((o) => o.date === date).map((o) => o.status);
                    const cls = statuses.every((s) => s === "cancelled")
                      ? " regimen-detail__day--cancelled"
                      : statuses.every((s) => s === "completed")
                        ? " regimen-detail__day--completed"
                        : "";
                    return (
                      <button
                        key={date}
                        type="button"
                        className={`regimen-detail__day${cls}`}
                        onClick={() => onOpenDay(date)}
                        title={`${date} を開く`}
                      >
                        {date.slice(5).replace("-", "/")}
                      </button>
                    );
                  })}
                </td>
              </tr>
            );
          })}
          {cycles.length === 0 && (
            <tr>
              <td colSpan={3} className="master-search__empty">
                登録されたクールがありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="lab-order-item__actions">
        {active && (
          <button type="button" onClick={() => setAdding(true)} disabled={reachedPlanned}>
            第 {next.cycle} クールを登録
          </button>
        )}
        {active && (
          <button type="button" onClick={handleRevoke} disabled={revoke.isPending}>
            レジメンを中止
          </button>
        )}
      </div>
      {reachedPlanned && active && (
        <p className="injection-scope__note">予定クール数({application.plannedCycles})まで登録済みです。</p>
      )}
    </div>
  );
}

interface RegimenDayPanelProps {
  patientId: string;
  regimenSrId: string;
  date: string;
  onEditInjection: (srId: string) => void;
  onEditPrescription: (srId: string) => void;
  onSaved: () => void;
}

type Scope = "one" | "following";

export function RegimenDayPanel({
  patientId,
  regimenSrId,
  date,
  onEditInjection,
  onEditPrescription,
  onSaved,
}: RegimenDayPanelProps) {
  const { application, orders, isPending, error } = useRegimen(patientId, regimenSrId);
  const updateStatus = useUpdateRegimenDayStatus();
  const move = useUpdatePrescription();
  const [scope, setScope] = useState<Scope>("one");
  const [moveTo, setMoveTo] = useState(date);

  if (isPending) return <p>読み込み中...</p>;
  if (!application) return <ErrorBanner error={error ?? new Error("レジメンの適用が見つかりません")} />;

  const todays = orders.filter((o) => o.date === date);
  const following = orders.filter((o) => o.date > date);
  const targets = scope === "following" ? [...todays, ...following] : todays;
  // 実施済は動かせないし止められない(済んだ事実)。
  const movable = targets.filter((o) => o.status !== "completed");
  const cancellable = targets.filter((o) => o.status !== "completed" && o.status !== "cancelled");
  const restorable = targets.filter((o) => o.status === "cancelled");
  const delta = diffDays(date, moveTo);
  const label = todays[0] ? cycleDayLabel(todays[0].ref) : "";

  function handleMove() {
    if (delta === 0 || movable.length === 0) return;
    const text =
      scope === "following"
        ? `${date} 以降の ${movable.length} 件を ${delta > 0 ? `${delta} 日後` : `${-delta} 日前`}に移動します。よろしいですか？`
        : `${date} のオーダーを ${moveTo} に移動します。よろしいですか？`;
    if (!window.confirm(text)) return;
    move.mutate(buildRegimenMoveBundle(movable, delta, patientId), { onSuccess: onSaved });
  }

  function handleCancel() {
    if (cancellable.length === 0) return;
    if (!window.confirm(`${cancellable.length} 件のオーダーを中止します。よろしいですか？`)) return;
    updateStatus.mutate({ targets: cancellable, status: "cancelled" }, { onSuccess: onSaved });
  }

  function handleRestore() {
    if (restorable.length === 0) return;
    updateStatus.mutate({ targets: restorable, status: "requested" }, { onSuccess: onSaved });
  }

  return (
    <div className="regimen-day">
      <ErrorBanner error={error ?? updateStatus.error ?? move.error} />
      <p className="regimen-day__title">
        {application.name} {label} <span className="regimen-day__date">{date}</span>
      </p>

      <ul className="regimen-day__orders">
        {todays.map((order) => (
          <li key={order.serviceRequest.id} className="regimen-day__order">
            <div className="regimen-day__order-head">
              <span className="regimen-day__kind">{order.kind === "injection" ? "注射" : "処方"}</span>
              <span className={`regimen-day__status regimen-day__status--${order.status}`}>
                {regimenDayStatusLabel(order.status)}
              </span>
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() =>
                  order.kind === "injection"
                    ? onEditInjection(order.serviceRequest.id ?? "")
                    : onEditPrescription(order.serviceRequest.id ?? "")
                }
              >
                編集
              </button>
            </div>
            {/* 中身はカルテのカードと同じ組み(RP ごとに薬剤 → 用法)にする。
                同じオーダーを 2 か所で違う形に見せない。 */}
            <RegimenOrderBody order={order} />
          </li>
        ))}
        {todays.length === 0 && <li className="regimen-day__empty">この日のオーダーはありません</li>}
      </ul>

      {todays.length > 0 && (
        <>
          <fieldset className="injection-scope">
            <legend>反映範囲</legend>
            <label className="injection-scope__option">
              <input type="radio" name="regimen-scope" checked={scope === "one"} onChange={() => setScope("one")} />
              この日のみ
            </label>
            <label className="injection-scope__option">
              <input
                type="radio"
                name="regimen-scope"
                checked={scope === "following"}
                onChange={() => setScope("following")}
                disabled={following.length === 0}
              />
              {`この日以降すべて(${todays.length + following.length} 件)`}
            </label>
          </fieldset>

          <fieldset className="regimen-day__move">
            <legend>移動</legend>
            <div className="regimen-day__move-row">
              <input type="date" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} />
              <span className="injection-scope__note">
                {delta === 0 ? "移動先の日付を選んでください" : delta > 0 ? `${delta} 日後へ` : `${-delta} 日前へ`}
              </span>
              <button
                type="button"
                onClick={handleMove}
                disabled={delta === 0 || movable.length === 0 || move.isPending}
              >
                移動
              </button>
            </div>
            {movable.length < targets.length && (
              <p className="injection-scope__note">実施済のオーダーは動かしません。</p>
            )}
          </fieldset>

          <div className="lab-order-item__actions">
            <button type="button" onClick={handleCancel} disabled={cancellable.length === 0 || updateStatus.isPending}>
              中止
            </button>
            <button type="button" onClick={handleRestore} disabled={restorable.length === 0 || updateStatus.isPending}>
              中止を取消
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 日オーダー 1 件の中身。カルテのカード(KarteTimeline)と同じ `.karte-rp` の組みで、
 * RP ごとに薬剤(名前・投与量・コメント)と用法を並べる。
 */
function RegimenOrderBody({ order }: { order: RegimenDayOrder }) {
  if (order.kind === "injection") {
    const rps = groupInjectionByRp(order.medicationRequests);
    if (rps.length === 0) return <p className="karte-card__empty">注射内容がありません。</p>;
    return (
      <>
        {rps.map((rp) => (
          <div className="karte-rp" key={rp.rpNumber}>
            <div className="karte-rp__head">
              <span className="karte-rp__number">{`RP${rp.rpNumber}`}</span>
            </div>
            <ul className="karte-rp__medicines">
              {rp.medicines.map((medicine) => (
                <li key={medicine.orderInRp}>
                  <span className="karte-rp__medicine-name">{medicine.name}</span>
                  {medicine.dose != null && (
                    <span className="karte-rp__medicine-dose">{`${medicine.dose}${medicine.unit ?? ""}`}</span>
                  )}
                  {medicine.comment && <span className="karte-rp__comment">{`（${medicine.comment}）`}</span>}
                </li>
              ))}
            </ul>
            <div className="karte-rp__detail">
              <span className="karte-rp__detail-label">用法:</span>
              <span>{injectionUsageSummary(rp) || "-"}</span>
              {rp.usageComment && <span className="karte-rp__comment">{`（${rp.usageComment}）`}</span>}
            </div>
            {rp.times.length > 0 && (
              <div className="karte-rp__detail">
                <span className="karte-rp__detail-label">時刻:</span>
                <span>{injectionTimesLabel(rp.times)}</span>
              </div>
            )}
          </div>
        ))}
      </>
    );
  }

  const rps = groupByRp(order.medicationRequests);
  if (rps.length === 0) return <p className="karte-card__empty">処方内容がありません。</p>;
  return (
    <>
      {rps.map((rp) => (
        <div className="karte-rp" key={rp.rpNumber}>
          <div className="karte-rp__head">
            <span className="karte-rp__number">{`RP${rp.rpNumber}`}</span>
          </div>
          <ul className="karte-rp__medicines">
            {rp.medicines.map((medicine) => (
              <li key={medicine.orderInRp}>
                <span className="karte-rp__medicine-name">{medicine.name}</span>
                {medicine.dose != null && (
                  <span className="karte-rp__medicine-dose">{`${medicine.dose}${medicine.unit ?? ""}`}</span>
                )}
                {medicine.comment && <span className="karte-rp__comment">{`（${medicine.comment}）`}</span>}
              </li>
            ))}
          </ul>
          <div className="karte-rp__detail">
            <span className="karte-rp__detail-label">用法:</span>
            <span>{rp.usageName ?? "-"}</span>
            {rp.doseDays != null && <span className="karte-rp__dose">{`${rp.doseDays}日分`}</span>}
            {rp.usageComment && <span className="karte-rp__comment">{`（${rp.usageComment}）`}</span>}
          </div>
        </div>
      ))}
    </>
  );
}

interface RegimenMoveModalProps {
  patientId: string;
  /** 動かす元の日と、その日のオーダー。 */
  from: string;
  todays: RegimenDayOrder[];
  /** 元の日より後のオーダー(「この日以降すべて」の対象)。 */
  following: RegimenDayOrder[];
  to: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * 暦でドラッグ＆ドロップしたときの確認。落とした先は決まっているので、残る選択は
 * 反映範囲(この日のみ / この日以降すべて)だけ。注射の中止と同じ 3 ボタンの形にする。
 * 実施済は動かさない(済んだ事実)。
 */
export function RegimenMoveModal({ patientId, from, todays, following, to, onClose, onDone }: RegimenMoveModalProps) {
  const move = useUpdatePrescription();
  const delta = diffDays(from, to);
  const movableToday = todays.filter((o) => o.status !== "completed");
  const movableFollowing = following.filter((o) => o.status !== "completed");
  const label = todays[0] ? cycleDayLabel(todays[0].ref) : "";
  const direction = delta > 0 ? `${delta} 日後` : `${-delta} 日前`;

  function run(withFollowing: boolean) {
    const targets = withFollowing ? [...movableToday, ...movableFollowing] : movableToday;
    if (targets.length === 0) return;
    move.mutate(buildRegimenMoveBundle(targets, delta, patientId), { onSuccess: onDone });
  }

  return (
    <Modal title="投与日の移動" onClose={onClose}>
      <ErrorBanner error={move.error} />
      <p>
        {label && <span className="injection-series-label">{label}</span>}
        {`${from} のオーダーを ${to}(${direction})へ移動します。`}
      </p>
      {movableFollowing.length > 0 && (
        <p className="injection-scope__note">
          {`この後に ${movableFollowing.length} 件のオーダーがあります。まとめて同じ日数ずらすこともできます。`}
        </p>
      )}
      {movableToday.length < todays.length && (
        <p className="injection-scope__note">実施済のオーダーは動かしません。</p>
      )}
      <div className="plain-text-modal__actions">
        <button type="button" onClick={onClose} disabled={move.isPending}>
          キャンセル
        </button>
        <button type="button" onClick={() => run(false)} disabled={move.isPending || movableToday.length === 0}>
          {movableFollowing.length > 0 ? "この日のみ移動" : "移動"}
        </button>
        {movableFollowing.length > 0 && (
          <button type="button" onClick={() => run(true)} disabled={move.isPending}>
            {`この日以降 ${movableToday.length + movableFollowing.length} 件を移動`}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** 暦のヘッダに並べる適用の一覧(選択タブ)。 */
export function regimenTabLabel(application: RegimenApplication): string {
  return application.status === "active"
    ? application.name
    : `${application.name}(${regimenStatusLabel(application.status)})`;
}
