import { useState } from "react";
import {
  useCancelAppointment,
  useMoveRegimenDays,
  useOrderAppointments,
  usePatient,
  useRevokeRegimen,
  useUpdatePrescription,
  useUpdateRegimenDayStatus,
} from "../api/queries";
import { appointmentDateTimeLabel } from "../fhir/appointmentHelpers";
import { groupInjectionByRp, injectionTimesLabel, injectionUsageSummary } from "../fhir/injectionHelpers";
import { groupByRp, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  REGIMEN_DISCONTINUATION_REASON_OPTIONS,
  buildRegimenHeaderUpdateBundle,
  cycleDayLabel,
  cycleStartDates,
  headerValuesOf,
  lastAdministrationDate,
  validateRegimenHeader,
  type RegimenHeaderValues,
  dayOrderCancelReason,
  nextCycleOf,
  previousCycleOf,
  regimenDayStatusLabel,
  type RegimenApplication,
  type RegimenDayOrder,
} from "../fhir/regimenOrderHelpers";
import { SETTING_OPTIONS } from "../fhir/shared";
import { diffDays } from "../lib/dates";
import { useRegimenApplication } from "../hooks/useRegimenApplication";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";
import { Modal } from "./Modal";
import { ChemoBookModal } from "./ChemoBookModal";
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
        previousCycle={previousCycleOf(orders, next.cycle)}
        lastAdministered={lastAdministrationDate(orders)}
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
  const move = useMoveRegimenDays();
  const [scope, setScope] = useState<Scope>("one");
  const [cancelReason, setCancelReason] = useState("");
  const [moveTo, setMoveTo] = useState(date);
  // 外来化学療法室の予約(§7.6 D-3)。注射のオーダーに対して日ごとに取る。
  const [booking, setBooking] = useState<{ order: fhir4.ServiceRequest; appointment?: fhir4.Appointment } | null>(null);
  const patient = usePatient(patientId).data?.data;
  const injectionOrders = orders.filter((o) => o.date === date && o.kind === "injection");
  // 予約は「この日以降すべて」の移動・中止で後続日のぶんも取り消すので、適用の全注射オーダーぶん読む。
  const appointments = useOrderAppointments(
    orders.filter((o) => o.kind === "injection").map((o) => o.serviceRequest.id ?? ""),
  );
  const cancelAppointment = useCancelAppointment();

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

  /** 対象のオーダーに取ってある化学療法室の予約の数(移動・中止で一緒に取り消す)。 */
  function bookedCount(list: RegimenDayOrder[]): number {
    return list.filter((o) => appointments.data?.has(o.serviceRequest.id ?? "")).length;
  }

  function bookingNote(list: RegimenDayOrder[], after: string): string {
    const count = bookedCount(list);
    return count > 0 ? `\n外来化学療法室の予約 ${count} 件も取り消します。${after}` : "";
  }

  function handleMove() {
    if (delta === 0 || movable.length === 0) return;
    const text =
      scope === "following"
        ? `${date} 以降の ${movable.length} 件を ${delta > 0 ? `${delta} 日後` : `${-delta} 日前`}に移動します。`
        : `${date} のオーダーを ${moveTo} に移動します。`;
    if (!window.confirm(`${text}${bookingNote(movable, "移動後に予約し直してください。")}よろしいですか？`)) return;
    move.mutate({ targets: movable, deltaDays: delta, patientId }, { onSuccess: onSaved });
  }

  function handleCancel() {
    if (cancellable.length === 0) return;
    if (!window.confirm(`${cancellable.length} 件のオーダーを中止します。${bookingNote(cancellable, "")}よろしいですか？`)) {
      return;
    }
    updateStatus.mutate({ targets: cancellable, status: "cancelled", reason: cancelReason }, { onSuccess: onSaved });
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
                {dayOrderCancelReason(order) && (
                  <span className="regimen-day__reason">{dayOrderCancelReason(order)}</span>
                )}
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

      {/* 予約はオーダーの中身ではなく「その日に化学療法室をいつ押さえるか」なので、
          注射オーダーの枠の外に専用の欄として置く(§7.6 D-3)。 */}
      {injectionOrders.length > 0 && (
        <fieldset className="regimen-day__booking-fields">
          <legend>外来化学療法室</legend>
          {injectionOrders.map((order) => (
            <RegimenDayBooking
              key={order.serviceRequest.id}
              appointment={appointments.data?.get(order.serviceRequest.id ?? "")}
              onBook={() => setBooking({ order: order.serviceRequest })}
              onReschedule={(appointment) => setBooking({ order: order.serviceRequest, appointment })}
              onCancel={(appointment) => {
                if (!window.confirm("この予約を取り消します。よろしいですか？")) return;
                cancelAppointment.mutate(appointment);
              }}
            />
          ))}
        </fieldset>
      )}

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

          {booking && (
        <ChemoBookModal
          order={booking.order}
          patient={patient}
          appointment={booking.appointment}
          label={`${application.name} ${label} ${date}`}
          onClose={() => setBooking(null)}
        />
      )}

      {cancellable.length > 0 && (
            <div className="lab-order-item__fields">
              <label className="regimen-apply__reason">
                中止理由
                <input type="text" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              </label>
            </div>
          )}
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
  const move = useMoveRegimenDays();
  const delta = diffDays(from, to);
  const movableToday = todays.filter((o) => o.status !== "completed");
  const movableFollowing = following.filter((o) => o.status !== "completed");
  const label = todays[0] ? cycleDayLabel(todays[0].ref) : "";
  const direction = delta > 0 ? `${delta} 日後` : `${-delta} 日前`;
  // 動かす日に取ってある化学療法室の予約は取り消す(日時が変わるので取り直してもらう)。
  const appointments = useOrderAppointments(
    [...movableToday, ...movableFollowing].filter((o) => o.kind === "injection").map((o) => o.serviceRequest.id ?? ""),
  );
  const bookedToday = movableToday.filter((o) => appointments.data?.has(o.serviceRequest.id ?? "")).length;
  const bookedFollowing = movableFollowing.filter((o) => appointments.data?.has(o.serviceRequest.id ?? "")).length;

  function run(withFollowing: boolean) {
    const targets = withFollowing ? [...movableToday, ...movableFollowing] : movableToday;
    if (targets.length === 0) return;
    move.mutate({ targets, deltaDays: delta, patientId }, { onSuccess: onDone });
  }

  return (
    <Modal title="投与日の移動" onClose={onClose}>
      <ErrorBanner error={move.error} />
      <p>
        {label && <span className="injection-series-label">{label}</span>}
        {`${from} のオーダーを ${to}(${direction})へ移動します。`}
      </p>
      {bookedToday + bookedFollowing > 0 && (
        <p className="injection-scope__note">
          {`外来化学療法室の予約(この日 ${bookedToday} 件${bookedFollowing > 0 ? `、この日以降 ${bookedFollowing} 件` : ""})は取り消します。移動後に予約し直してください。`}
        </p>
      )}
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


interface RegimenRevokeModalProps {
  application: RegimenApplication;
  header: fhir4.ServiceRequest;
  orders: RegimenDayOrder[];
  onClose: () => void;
  onDone: () => void;
}

/**
 * レジメンの中止の確認(§7.6 C-2)。理由の区分と自由記述を残すので、確認だけの
 * `window.confirm` ではなくモーダルにする。未実施の日オーダーは一緒に中止になる。
 */
export function RegimenRevokeModal({ application, header, orders, onClose, onDone }: RegimenRevokeModalProps) {
  const revoke = useRevokeRegimen();
  const [reason, setReason] = useState<string>(REGIMEN_DISCONTINUATION_REASON_OPTIONS[0].code);
  const [note, setNote] = useState("");
  const pending = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");
  const appointments = useOrderAppointments(
    pending.filter((o) => o.kind === "injection").map((o) => o.serviceRequest.id ?? ""),
  );
  const booked = pending.filter((o) => appointments.data?.has(o.serviceRequest.id ?? "")).length;

  function run() {
    revoke.mutate({ header, targets: orders, discontinuation: { reason, note } }, { onSuccess: onDone });
  }

  return (
    <Modal title="レジメンの中止" onClose={onClose}>
      <ErrorBanner error={revoke.error} />
      <p>{`${application.name} を中止します。`}</p>
      {pending.length > 0 && (
        <p className="injection-scope__note">
          {`未実施の ${pending.length} 件のオーダーも中止になります。${booked > 0 ? `外来化学療法室の予約 ${booked} 件も取り消します。` : ""}`}
        </p>
      )}
      <div className="lab-order-item__fields">
        <label>
          理由
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REGIMEN_DISCONTINUATION_REASON_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label className="regimen-apply__reason">
          詳細
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="plain-text-modal__actions">
        <button type="button" onClick={onClose} disabled={revoke.isPending}>
          キャンセル
        </button>
        <button type="button" onClick={run} disabled={revoke.isPending}>
          中止する
        </button>
      </div>
    </Modal>
  );
}

/** 投与日の予約(外来化学療法室)。予約済みなら日時と操作、無ければ「予約」ボタン。 */
function RegimenDayBooking({
  appointment,
  onBook,
  onReschedule,
  onCancel,
}: {
  appointment?: fhir4.Appointment;
  onBook: () => void;
  onReschedule: (appointment: fhir4.Appointment) => void;
  onCancel: (appointment: fhir4.Appointment) => void;
}) {
  return (
    <div className="regimen-day__booking">
      {appointment ? (
        <>
          <span className="regimen-day__booking-time">{appointmentDateTimeLabel(appointment)}</span>
          <span className="regimen-day__booking-status">予約済み</span>
          <button type="button" className="rp-card__compact-button" onClick={() => onReschedule(appointment)}>
            日時変更
          </button>
          <button type="button" className="rp-card__compact-button" onClick={() => onCancel(appointment)}>
            予約取消
          </button>
        </>
      ) : (
        <>
          <span className="regimen-day__booking-status">未予約</span>
          <button type="button" className="rp-card__compact-button" onClick={onBook}>
            予約
          </button>
        </>
      )}
    </div>
  );
}

/**
 * 適用のヘッダの編集(右ペイン、§7.6 C-6)。左ペインの詳細ビューから開く。
 *
 * ［決定］直せるのは**適用の枠**(入外区分・予定クール数・プロブレム・コメント)だけ。投与内容は
 * レジメンマスタのもので、体格は登録済みの投与量の根拠なので直させない(§7.6 B-8)。
 * 予定クール数を延ばせることがこの画面の主目的で、いままでは予定数に達すると適用し直すしか
 * 続ける手が無かった。
 */
export function RegimenHeaderPanel({
  patientId,
  regimenSrId,
  onSaved,
}: {
  patientId: string;
  regimenSrId: string;
  onSaved: () => void;
}) {
  const { application, header, orders, isPending, error } = useRegimenApplication(patientId, regimenSrId);
  const update = useUpdatePrescription();
  const problems = useProblemOptions(patientId);
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [values, setValues] = useState<RegimenHeaderValues | null>(null);

  if (isPending) return <p>読み込み中...</p>;
  if (!application || !header) return <ErrorBanner error={error ?? new Error("レジメンの適用が見つかりません")} />;

  const current = values ?? headerValuesOf(application);
  const registered = cycleStartDates(orders).size;

  function set<K extends keyof RegimenHeaderValues>(key: K, value: RegimenHeaderValues[K]) {
    setValues({ ...current, [key]: value });
  }

  function handleSubmit() {
    if (!header) return;
    const message = validateRegimenHeader(current);
    setValidationError(message);
    if (message) return;
    // 登録済みのクールより少ない予定数にすると「予定を超えて登録済み」の状態になるので止める。
    if (current.plannedCycles.trim() !== "" && Number(current.plannedCycles) < registered) {
      setValidationError(`第 ${registered} クールまで登録済みです。予定クール数はそれ以上にしてください`);
      return;
    }
    update.mutate(buildRegimenHeaderUpdateBundle(header, current), { onSuccess: onSaved });
  }

  return (
    <div className="regimen-detail">
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={error ?? update.error} />
      <p className="regimen-day__title">{`${application.name}（開始 ${application.startDate}）`}</p>

      <fieldset className="regimen-apply__fields">
        <legend>適用</legend>
        <div className="lab-order-item__fields">
          <label>
            入外区分
            <select value={current.setting} onChange={(e) => set("setting", e.target.value as PrescriptionSetting)}>
              <option value="">選択</option>
              {SETTING_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            予定クール数
            <input
              type="number"
              min="1"
              value={current.plannedCycles}
              onChange={(e) => set("plannedCycles", e.target.value)}
              placeholder="空欄は継続"
            />
          </label>
          <label>
            対象プロブレム
            <ProblemSelect value={current.problem} options={problems} onChange={(p) => set("problem", p)} />
          </label>
          <label>
            コメント
            <input type="text" value={current.comment} onChange={(e) => set("comment", e.target.value)} />
          </label>
        </div>
      </fieldset>
      <p className="injection-scope__note">
        入外区分は次に登録するクールから使います。登録済みの投与日はそのままです。
      </p>

      <div className="lab-order-item__actions">
        <button type="button" onClick={handleSubmit} disabled={update.isPending}>
          更新
        </button>
      </div>
    </div>
  );
}
