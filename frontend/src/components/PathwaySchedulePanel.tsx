import { useMemo, useState } from "react";
import {
  useNursingPerformsOf,
  usePathwayApplicationTree,
  usePathwayObservations,
  useShiftPathwaySchedule,
} from "../api/queries";
import { orderKindOf } from "../fhir/karteTimeline";
import type { OrderSetOrderType } from "../fhir/orderSetHelpers";
import { buildEvaluationState } from "../fhir/pathwayEvaluationHelpers";
import { eventDayStepLabel } from "../fhir/pathwayHelpers";
import { buildPathwayShiftBundle, orderStartDate, planPathwayShift, type PathwayRecordContext } from "../fhir/pathwayScheduleHelpers";
import { nursingPerformDates } from "../fhir/pathwaySheetHelpers";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { ORDER_SET_TYPE_LABELS } from "./orderSetRegistry";

// パスの日程の変更。パスシートの見出しのメニューから開き、起点の病日から後ろをまとめてずらす
// (入院日・手術日が動いたとき)。病日・タスクの予定日と看護指示・食事の日付を 1 回で書き換え、
// その他のオーダーは日付を直す一覧に挙げる(シートのセルにも「日付違い」が出る)。
// 設計は docs/clinical-pathway-design.md §7.8。

interface PathwaySchedulePanelProps {
  patientId: string;
  applyId: string;
  onSaved: () => void;
}

export function PathwaySchedulePanel({ patientId, applyId, onSaved }: PathwaySchedulePanelProps) {
  const tree = usePathwayApplicationTree(applyId);
  const observations = usePathwayObservations(patientId);
  const performs = useNursingPerformsOf(patientId);
  const shift = useShiftPathwaySchedule();
  const [validationError, setValidationError, validationErrorRef] = useValidationError();

  const ctx = useMemo<PathwayRecordContext | null>(() => {
    const application = tree.data?.application;
    if (!tree.data || !application || !observations.data) return null;
    return {
      application,
      carePlans: tree.data.carePlans,
      procedures: tree.data.procedures,
      goals: tree.data.goals,
      orders: tree.data.orders,
      evaluation: buildEvaluationState(observations.data, tree.data.goals, [...tree.data.carePlans.values()]),
      performDates: nursingPerformDates(performs.data),
    };
  }, [tree.data, observations.data, performs.data]);

  const events = useMemo(
    () => [...(ctx?.application.events ?? [])].sort((a, b) => a.elapsedDays - b.elapsedDays || a.pathStep - b.pathStep),
    [ctx],
  );

  // 起点の既定は、記録(評価・実施)のある最後の病日の次。記録が無ければ最初の病日。
  const defaultFromId = useMemo(() => {
    if (!ctx) return "";
    let lastRecorded = -1;
    events.forEach((event, index) => {
      const recorded =
        event.units.some((unit) => {
          const state = ctx.evaluation?.units.get(unit.id);
          return Boolean(state?.goal || state?.observation) || unit.assessments.some((a) => ctx.evaluation?.results.has(a.id));
        }) || event.units.some((unit) => unit.assessments.some((a) => a.tasks.some((t) => t.done)));
      if (recorded) lastRecorded = index;
    });
    return events[Math.min(lastRecorded + 1, events.length - 1)]?.id ?? "";
  }, [ctx, events]);

  const [fromId, setFromId] = useState("");
  const [newDate, setNewDate] = useState("");
  const effectiveFromId = fromId || defaultFromId;
  const fromEvent = events.find((e) => e.id === effectiveFromId);
  const effectiveDate = newDate || fromEvent?.date || "";
  const plan = ctx && effectiveFromId ? planPathwayShift(ctx, effectiveFromId, effectiveDate) : null;

  if (tree.isPending || observations.isPending || performs.isPending) return <p>読み込み中...</p>;
  if (!ctx || !plan) return <ErrorBanner error={tree.error ?? observations.error ?? performs.error} />;
  const application = ctx.application;

  function handleSave() {
    if (!ctx || !plan) return;
    if (plan.days === 0) {
      setValidationError("新しい日付を入力してください");
      return;
    }
    if (plan.blockers.length > 0) {
      setValidationError("変更できない理由があります");
      return;
    }
    setValidationError(null);
    shift.mutate(buildPathwayShiftBundle(ctx, plan), { onSuccess: onSaved });
  }

  return (
    <div className="pathway-evaluate">
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={shift.error} />

      <div className="chemo-calendar__summary pathway-evaluate__head">
        <span className="pathway-sheet__name">{application.title}</span>
        <span>入院 {application.periodStart}</span>
      </div>

      <fieldset className="regimen-apply__fields">
        <legend>日程</legend>
        <div className="lab-order-item__fields">
          <label>
            起点の病日
            <select
              value={effectiveFromId}
              onChange={(e) => {
                setFromId(e.target.value);
                setNewDate("");
              }}
            >
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {`${event.elapsedDays} ${eventDayStepLabel(event.elapsedDays, event.title, event.pathStep, event.pathStepName)} ${event.date}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            新しい日付
            <input type="date" value={effectiveDate} onChange={(e) => setNewDate(e.target.value)} />
          </label>
          {plan.days !== 0 && (
            <div className="regimen-editor__derived">
              ずらす日数
              <strong>{plan.days > 0 ? `${plan.days} 日後ろ` : `${-plan.days} 日前`}</strong>
            </div>
          )}
        </div>

        {plan.days !== 0 && (
          <table className="master-search__table pathway-apply__days">
            <thead>
              <tr>
                <th className="rad-item__compact">病日</th>
                <th>今の日付</th>
                <th>新しい日付</th>
              </tr>
            </thead>
            <tbody>
              {plan.events.map(({ event, from, to }) => (
                <tr key={event.id}>
                  <td className="rad-item__compact">
                    {`${event.elapsedDays} ${eventDayStepLabel(event.elapsedDays, event.title, event.pathStep, event.pathStepName)}`}
                  </td>
                  <td>{from}</td>
                  <td>{to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </fieldset>

      {plan.days !== 0 && plan.blockers.length > 0 && (
        <div className="error-banner" role="status">
          {plan.blockers.map((message) => (
            <p key={message} className="error-banner__line error-banner__line--error">
              {message}
            </p>
          ))}
        </div>
      )}

      {plan.days !== 0 && plan.autoOrders.length > 0 && (
        <fieldset className="regimen-apply__fields">
          <legend>{`日付をずらす看護指示・食事(${plan.autoOrders.length} 件)`}</legend>
          <ul className="pathway-apply__conditions pathway-schedule__list">
            {plan.autoOrders.map((order) => {
              const before = ctx.orders.get(order.id ?? "");
              return (
                <li key={order.id}>
                  {orderTitle(order)}
                  <span className="lab-order-item__code">
                    {`${periodLabel(before)} → ${periodLabel(order)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {plan.days !== 0 && plan.manualOrders.length > 0 && (
        <fieldset className="regimen-apply__fields">
          <legend>{`日付を直すオーダー(${plan.manualOrders.length} 件)`}</legend>
          <ul className="pathway-apply__conditions pathway-schedule__list">
            {plan.manualOrders.map(({ order, taskName, currentDate, newDate: target }) => {
              const kind = orderKindOf(order);
              return (
                <li key={order.id}>
                  {kind && (
                    <span className="pathway-task__template-label">
                      {ORDER_SET_TYPE_LABELS[kind as OrderSetOrderType] ?? ""}
                    </span>
                  )}
                  {taskName}
                  <span className="lab-order-item__code">{`${currentDate || "日付なし"} → ${target}`}</span>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <div className="lab-order-item__actions">
        <button
          type="button"
          onClick={handleSave}
          disabled={shift.isPending || plan.days === 0 || plan.blockers.length > 0}
        >
          {shift.isPending ? "送信中..." : "変更する"}
        </button>
      </div>
    </div>
  );
}

function orderTitle(order: fhir4.ServiceRequest): string {
  return order.code?.text ?? order.code?.coding?.[0]?.display ?? "";
}

/** 看護指示・食事の期間の表示(開始〜終了)。 */
function periodLabel(order: fhir4.ServiceRequest | undefined): string {
  if (!order) return "";
  const start = orderStartDate(order);
  const end = order.extension?.find((e) => /(nursing|meal)-order-end$/.test(e.url));
  const endValue = (end?.valueDate ?? end?.valueDateTime ?? "").slice(0, 10);
  return `${start}〜${endValue}`;
}
