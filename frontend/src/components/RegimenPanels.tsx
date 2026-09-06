import { useState } from "react";
import { useUpdatePrescription, useUpdateRegimenDayStatus } from "../api/queries";
import { groupInjectionByRp, injectionTimesLabel, injectionUsageSummary } from "../fhir/injectionHelpers";
import { groupByRp } from "../fhir/prescriptionHelpers";
import {
  buildRegimenMoveBundle,
  cycleDayLabel,
  nextCycleOf,
  regimenDayStatusLabel,
  type RegimenDayOrder,
} from "../fhir/regimenOrderHelpers";
import { diffDays } from "../lib/dates";
import { useRegimenApplication } from "../hooks/useRegimenApplication";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { RegimenCyclePanel } from "./RegimenApplyPanel";

// カルテ右ペインの、適用済みレジメンに対する操作。
//   RegimenCycleLoader … 次クールの登録(左ペインの詳細ビューから開く)
//   RegimenDayPanel    … 暦の 1 日。その日のオーダーの編集・移動・中止
//   RegimenMoveModal   … 暦のドラッグ＆ドロップで落としたときの確認
// 適用の概要とクール一覧は左ペイン(RegimenDetailView)の担当。

/**
 * 適用済みレジメンに次のクールを登録する(右ペイン)。左ペインの詳細ビューから開くので
 * 受け取るのはヘッダの id だけで、何クール目か・Day 1 をいつにするかはここで出す。
 */
export function RegimenCycleLoader({
  patientId,
  regimenSrId,
  onSaved,
}: {
  patientId: string;
  regimenSrId: string;
  onSaved: () => void;
}) {
  const { application, orders, isPending, error } = useRegimenApplication(patientId, regimenSrId);

  if (isPending) return <p>読み込み中...</p>;
  if (!application) return <ErrorBanner error={error ?? new Error("レジメンの適用が見つかりません")} />;

  const next = nextCycleOf(application, orders);
  return (
    <>
      <ErrorBanner error={error} />
      <RegimenCyclePanel
        patientId={patientId}
        application={application}
        cycle={next.cycle}
        startDate={next.startDate}
        onSaved={onSaved}
      />
    </>
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
  const { application, orders, isPending, error } = useRegimenApplication(patientId, regimenSrId);
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

