import { addDays, diffDays } from "../lib/dates";
import {
  buildMealOrderCloseEntry,
  DEFAULT_MEAL_TIMING,
  isMealServiceRequest,
  MEAL_ORDER_END_EXT_URL,
  mealOrderNeedsStop,
  previousMealPoint,
  type MealTiming,
} from "./mealOrderHelpers";
import {
  buildNursingOrderCloseEntry,
  isNursingServiceRequest,
  NURSING_ORDER_END_EXT_URL,
  nursingOrderNeedsStop,
} from "./nursingOrderHelpers";
import { PATHWAY_EXT, type PathwayApplicationRecord, type PathwayEventRecord } from "./pathwayApplyHelpers";
import { orderHasPerformed, type OrderProgress } from "./orderProgressHelpers";
import type { PathwayEvaluationState } from "./pathwayEvaluationHelpers";

// 適用したパスの日程の変更と、誤って適用したパスの取り消し。React に依存しない。
// 設計は docs/clinical-pathway-design.md §7.8・§7.9。

/** 変えずに残すオーダーの状態(終わった・取り下げたもの)。 */
const SETTLED_ORDER_STATUSES = new Set(["completed", "revoked", "entered-in-error"]);

/** 適用の木と、そこから辿れる記録。 */
export interface PathwayRecordContext {
  application: PathwayApplicationRecord;
  carePlans: Map<string, fhir4.CarePlan>;
  procedures: Map<string, fhir4.Procedure>;
  goals: Map<string, fhir4.Goal>;
  orders: Map<string, fhir4.ServiceRequest>;
  /** オーダーのヘッダの id → 進み具合(進捗の Task から。実施済みかはここで判定する)。 */
  orderProgress: Map<string, OrderProgress>;
  evaluation: PathwayEvaluationState | null;
  /** 看護指示の実施記録(指示の id → 記録のある日付)。 */
  performDates: Map<string, Set<string>>;
}

/** 病日を並べた順(病日 → ステップ)。 */
function sortedEvents(application: PathwayApplicationRecord): PathwayEventRecord[] {
  return [...application.events].sort((a, b) => a.elapsedDays - b.elapsedDays || a.pathStep - b.pathStep);
}

function eventLabel(event: PathwayEventRecord): string {
  const step = event.pathStep > 1 || event.pathStepName ? ` ${event.pathStepName || `ステップ${event.pathStep}`}` : "";
  return `病日 ${event.elapsedDays}${step}`;
}

/** 病日に評価(アウトカムの Goal・評価・観察項目の実績)が 1 つでもあるか。 */
function eventHasEvaluation(event: PathwayEventRecord, evaluation: PathwayEvaluationState | null): boolean {
  if (!evaluation) return false;
  return event.units.some((unit) => {
    const state = evaluation.units.get(unit.id);
    return Boolean(state?.goal || state?.observation) || unit.assessments.some((a) => evaluation.results.has(a.id));
  });
}

function eventTasks(event: PathwayEventRecord) {
  return event.units.flatMap((unit) => unit.assessments.flatMap((a) => a.tasks));
}

/** オーダーの開始日(日付部分)。持たなければ空。 */
export function orderStartDate(order: fhir4.ServiceRequest): string {
  return (order.occurrenceDateTime ?? order.occurrencePeriod?.start ?? "").slice(0, 10);
}

/** 日付・日時の日付部分だけを days ずらす(時刻とタイムゾーンは保つ)。 */
function shiftDateValue(value: string, days: number): string {
  return `${addDays(value.slice(0, 10), days)}${value.slice(10)}`;
}

function put<T extends fhir4.FhirResource>(resource: T): fhir4.BundleEntry {
  return { resource, request: { method: "PUT", url: `${resource.resourceType}/${resource.id}` } };
}

// ---- 日程の変更 ----

/** 自動ではずらさず、各オーダーの編集画面で直してもらうオーダー。 */
export interface PathwayManualOrder {
  order: fhir4.ServiceRequest;
  taskName: string;
  /** 今の開始日。 */
  currentDate: string;
  /** ずらした後の病日の日付。 */
  newDate: string;
}

export interface PathwayShiftPlan {
  /** ずらす日数(新しい日付 − 今の日付)。 */
  days: number;
  /** ずらす病日(起点から後ろ全部)と、今の日付・新しい日付。 */
  events: { event: PathwayEventRecord; from: string; to: string }[];
  /** ずらせない理由。1 つでもあれば登録しない。 */
  blockers: string[];
  /** 日付をずらす看護指示・食事(開始・終了を書き換える)。 */
  autoOrders: fhir4.ServiceRequest[];
  /** 日付を直す必要がある、その他の種別のオーダー。 */
  manualOrders: PathwayManualOrder[];
}

/**
 * 日程の変更の計画。起点の病日から後ろの病日を、起点の日付が newDate になるだけずらす。
 *
 * ［決定］評価・実施の記録がある病日はずらさない(記録の日付と病日が食い違う)。起点より後ろに
 * 記録があれば止め、記録のある病日より後ろを起点に選び直してもらう。前の病日を追い越す日付
 * (同じ病日のステップどうしは同じ日まで)にもできない。
 *
 * ［決定］オーダーは看護指示と食事だけを自動でずらす(日付がヘッダの ServiceRequest 1 本で完結する)。
 * 開始日が起点の今の日付以降ならずらし、終了日は後ろへずらすときは起点の前日以降、前へずらすときは
 * 起点以降のものをずらす(後ろへずらした日は、前日までの食事・安静度・指示がそのまま続く)。
 * その他の種別(注射・検査・手術など)は明細や予約・部門の受付を伴うので自動では触らず、
 * manualOrders に挙げて各オーダーの編集で直してもらう。
 */
export function planPathwayShift(ctx: PathwayRecordContext, fromEventId: string, newDate: string): PathwayShiftPlan {
  const events = sortedEvents(ctx.application);
  const fromIndex = events.findIndex((e) => e.id === fromEventId);
  const empty: PathwayShiftPlan = { days: 0, events: [], blockers: [], autoOrders: [], manualOrders: [] };
  if (fromIndex < 0 || !newDate) return empty;
  const from = events[fromIndex];
  const days = diffDays(from.date, newDate);
  const range = events.slice(fromIndex);
  const plan: PathwayShiftPlan = {
    ...empty,
    days,
    events: range.map((event) => ({ event, from: event.date, to: addDays(event.date, days) })),
  };
  if (days === 0) return plan;

  const previous = events[fromIndex - 1];
  if (previous) {
    const sameDay = previous.elapsedDays === from.elapsedDays;
    if (sameDay && newDate < previous.date) {
      plan.blockers.push(`${eventLabel(previous)}(${previous.date})より前の日付にはできません`);
    } else if (!sameDay && newDate <= previous.date) {
      plan.blockers.push(`${eventLabel(previous)}(${previous.date})と同じか前の日付にはできません`);
    }
  }
  for (const event of range) {
    if (eventHasEvaluation(event, ctx.evaluation)) plan.blockers.push(`${eventLabel(event)} に評価の記録があります`);
    if (eventTasks(event).some((task) => task.done)) plan.blockers.push(`${eventLabel(event)} に実施済みのタスクがあります`);
  }

  // 起点より後ろのタスクが指すオーダー(その他の種別は日付を直す一覧に挙げる)。
  const inRange = new Map<string, { taskName: string; date: string }>();
  for (const { event, to } of plan.events) {
    for (const task of eventTasks(event)) {
      for (const id of task.orderIds) if (!inRange.has(id)) inRange.set(id, { taskName: task.name, date: to });
    }
  }
  // 看護指示・食事は適用の木全体から拾う(起点の前日に終わる指示も後ろへずらすと延びるため)。
  const allOrderIds = new Set(events.flatMap((event) => eventTasks(event).flatMap((task) => task.orderIds)));
  const threshold = days > 0 ? addDays(from.date, -1) : from.date;
  for (const id of allOrderIds) {
    const order = ctx.orders.get(id);
    const progress = ctx.orderProgress.get(id);
    const completed = order ? (progress ? orderHasPerformed(progress) : order.status === "completed") : false;
    if (!order || completed || SETTLED_ORDER_STATUSES.has(order.status)) {
      if (completed && inRange.has(id)) {
        plan.blockers.push(`実施済みのオーダーがあります(${inRange.get(id)?.taskName})`);
      }
      continue;
    }
    const continuous = isNursingServiceRequest(order) || isMealServiceRequest(order);
    if (continuous) {
      const performed = [...(ctx.performDates.get(id) ?? [])].some((date) => date >= from.date);
      if (performed) plan.blockers.push(`起点より後ろに看護指示の実施記録があります(${inRange.get(id)?.taskName ?? orderTitle(order)})`);
      const shifted = shiftContinuousOrder(order, days, from.date, threshold);
      if (shifted) plan.autoOrders.push(shifted);
      continue;
    }
    const target = inRange.get(id);
    if (target) {
      plan.manualOrders.push({ order, taskName: target.taskName, currentDate: orderStartDate(order), newDate: target.date });
    }
  }
  plan.blockers = [...new Set(plan.blockers)];
  return plan;
}

function orderTitle(order: fhir4.ServiceRequest): string {
  return order.code?.text ?? order.code?.coding?.[0]?.display ?? "";
}

/** 看護指示・食事の開始・終了をずらした写し。どちらも動かなければ null。 */
function shiftContinuousOrder(
  order: fhir4.ServiceRequest,
  days: number,
  fromDate: string,
  threshold: string,
): fhir4.ServiceRequest | null {
  const endUrl = isMealServiceRequest(order) ? MEAL_ORDER_END_EXT_URL : NURSING_ORDER_END_EXT_URL;
  const next: fhir4.ServiceRequest = { ...order, extension: order.extension?.map((e) => ({ ...e })) };
  let changed = false;
  const start = order.occurrenceDateTime;
  if (start && start.slice(0, 10) >= fromDate) {
    next.occurrenceDateTime = shiftDateValue(start, days);
    changed = true;
  }
  const end = next.extension?.find((e) => e.url === endUrl);
  const endValue = end?.valueDate ?? end?.valueDateTime;
  if (end && endValue && endValue.slice(0, 10) >= threshold) {
    const shifted = shiftDateValue(endValue, days);
    // 前へずらして開始より前になる終了は、開始の日に揃える。
    const startDate = (next.occurrenceDateTime ?? "").slice(0, 10);
    const value = startDate && shifted.slice(0, 10) < startDate ? `${startDate}${shifted.slice(10)}` : shifted;
    if (end.valueDate !== undefined) end.valueDate = value;
    else end.valueDateTime = value;
    changed = true;
  }
  return changed ? next : null;
}

/**
 * 日程の変更の transaction。起点から後ろの病日の CarePlan(period)、そのタスクの Procedure
 * (予定日の拡張)、起点が最初の病日なら適用の CarePlan の開始、自動でずらす看護指示・食事を PUT する。
 */
export function buildPathwayShiftBundle(ctx: PathwayRecordContext, plan: PathwayShiftPlan): fhir4.Bundle {
  const entry: fhir4.BundleEntry[] = [];
  const events = sortedEvents(ctx.application);
  for (const { event, to } of plan.events) {
    const carePlan = ctx.carePlans.get(event.id);
    if (carePlan) entry.push(put({ ...carePlan, period: { ...carePlan.period, start: to, end: to } }));
    for (const task of eventTasks(event)) {
      const procedure = ctx.procedures.get(task.id);
      if (!procedure) continue;
      entry.push(
        put({
          ...procedure,
          extension: (procedure.extension ?? []).map((e) =>
            e.url === PATHWAY_EXT.taskPlannedDateTime && e.valueDate ? { ...e, valueDate: addDays(e.valueDate, plan.days) } : e,
          ),
        }),
      );
    }
  }
  if (plan.events[0]?.event.id === events[0]?.id) {
    const apply = ctx.carePlans.get(ctx.application.id);
    if (apply) entry.push(put({ ...apply, period: { ...apply.period, start: plan.events[0].to } }));
  }
  for (const order of plan.autoOrders) entry.push(put(order));
  return { resourceType: "Bundle", type: "transaction", entry };
}

// ---- フェーズの境界 ----

/** 次のフェーズの適用で終える、前のフェーズから続いている食事・安静度。 */
export interface PathwayPhaseClosing {
  order: fhir4.ServiceRequest;
  taskName: string;
  /** 終える日(食事は endTiming の食事まで)。 */
  endDate: string;
  endTiming?: MealTiming;
}

/**
 * 次のフェーズが食事・安静度を出すとき、前のフェーズから続いているもの(終わりを決めていないか、
 * 新しい開始より後まで続くもの)を新しい開始の直前で終える。同時に 2 つの食事・安静度が有効に
 * ならないようにする、フェーズの中の規則(pathwayOrderEnd)と同じ考え方。
 * 終わった・取り下げたオーダーは触らない。
 */
export function planPhaseOrderClosings(
  application: PathwayApplicationRecord,
  orders: Map<string, fhir4.ServiceRequest>,
  starts: { meal: { date: string; timing?: MealTiming } | null; activity: { date: string } | null },
): PathwayPhaseClosing[] {
  const closings = new Map<string, PathwayPhaseClosing>();
  for (const event of application.events) {
    for (const task of eventTasks(event)) {
      for (const id of task.orderIds) {
        const order = orders.get(id);
        if (!order || closings.has(id) || SETTLED_ORDER_STATUSES.has(order.status)) continue;
        if (isMealServiceRequest(order) && starts.meal) {
          const point = previousMealPoint(starts.meal.date, starts.meal.timing ?? DEFAULT_MEAL_TIMING);
          if (orderStartDate(order) > point.date || !mealOrderNeedsStop(order, point.date, point.timing)) continue;
          closings.set(id, { order, taskName: task.name, endDate: point.date, endTiming: point.timing });
        } else if (isNursingServiceRequest(order) && task.categoryLv1 === "AL" && starts.activity) {
          const endDate = addDays(starts.activity.date, -1);
          if (orderStartDate(order) > endDate || !nursingOrderNeedsStop(order, endDate)) continue;
          closings.set(id, { order, taskName: task.name, endDate });
        }
      }
    }
  }
  return [...closings.values()];
}

export function phaseClosingEntries(closings: PathwayPhaseClosing[]): fhir4.BundleEntry[] {
  return closings.map((c) =>
    c.endTiming
      ? buildMealOrderCloseEntry(c.order, c.endDate, c.endTiming)
      : buildNursingOrderCloseEntry(c.order, c.endDate),
  );
}

// ---- 適用の取り消し ----

export interface PathwayCancelPlan {
  /** 取り消せない理由。1 つでもあれば取り消さない。 */
  blockers: string[];
  /** 消すオーダー(雛形から出したもの・予定外で付けたもの)。既に消えているものは含まない。 */
  orders: { order: fhir4.ServiceRequest; taskName: string }[];
  /** 消す計画の木(CarePlan)・タスク(Procedure)・観察項目の Goal の id。 */
  carePlanIds: string[];
  procedureIds: string[];
  goalIds: string[];
}

/** 受付より先に進んだ部門の Task の状態(取り消すと部門の記録が宙に浮く)。 */
const PROGRESSED_TASK_STATUSES = new Set(["accepted", "in-progress", "on-hold", "completed", "ready"]);

/**
 * 誤って適用したパスの取り消し計画。［決定］取り消せるのは、まだ何も記録していない進行中の適用だけ
 * (評価・実績・実施済みのタスク・看護指示の実施記録・終わったオーダー・部門が受け付けたオーダーが無い)。
 * 記録が 1 つでもあれば、取り消しではなく中止にする(記録を消さない)。
 *
 * phaseKey を渡すとそのフェーズだけを取り消す(選び間違えた分岐を戻す)。対象は最後に適用したフェーズに
 * 限り、記録の有無もそのフェーズの病日だけで見る。適用の CarePlan と前のフェーズは残す。前のフェーズの
 * 食事・安静度に入れた終了は戻さない(次のフェーズを適用し直せば、また直前で終える)。
 */
export function planPathwayCancel(
  ctx: PathwayRecordContext,
  departmentTasks: fhir4.Task[],
  phaseKey?: string,
): PathwayCancelPlan {
  const blockers: string[] = [];
  const allEvents = sortedEvents(ctx.application);
  const events = phaseKey === undefined ? allEvents : allEvents.filter((e) => e.phaseKey === phaseKey);
  if (phaseKey !== undefined && (allEvents.at(-1)?.phaseKey !== phaseKey || events.length === allEvents.length)) {
    blockers.push("取り消せるのは、最後に適用した 2 つ目以降のフェーズだけです");
  }
  if (ctx.application.status !== "active") blockers.push("進行中のパスだけ取り消せます(終了・中止の記録を先に取り消してください)");
  for (const event of events) {
    if (eventHasEvaluation(event, ctx.evaluation)) blockers.push(`${eventLabel(event)} に評価の記録があります`);
    if (eventTasks(event).some((task) => task.done)) blockers.push(`${eventLabel(event)} に実施済みのタスクがあります`);
  }

  const orders: PathwayCancelPlan["orders"] = [];
  const seen = new Set<string>();
  for (const event of events) {
    for (const task of eventTasks(event)) {
      for (const id of task.orderIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        const order = ctx.orders.get(id);
        if (!order || order.status === "entered-in-error") continue;
        const progress = ctx.orderProgress.get(id);
        if (progress ? orderHasPerformed(progress) : order.status === "completed") {
          blockers.push(`実施済みのオーダーがあります(${task.name})`);
        }
        if ((ctx.performDates.get(id)?.size ?? 0) > 0) blockers.push(`看護指示の実施記録があります(${task.name})`);
        const progressed = departmentTasks.some(
          (t) =>
            PROGRESSED_TASK_STATUSES.has(t.status) &&
            (t.focus?.reference === `ServiceRequest/${id}` || t.basedOn?.some((b) => b.reference === `ServiceRequest/${id}`)),
        );
        if (progressed) blockers.push(`受け付け済みのオーダーがあります(${task.name})`);
        orders.push({ order, taskName: task.name });
      }
    }
  }

  // フェーズだけのときは、その病日と、病日を partOf に持つ子孫(OAT ユニット・観察項目)。
  const eventIds = new Set(events.map((e) => e.id));
  const carePlans = new Map(
    [...ctx.carePlans].filter(
      ([id, cp]) =>
        phaseKey === undefined ||
        eventIds.has(id) ||
        cp.partOf?.some((ref) => eventIds.has(ref.reference?.replace(/^CarePlan\//, "") ?? "")),
    ),
  );
  const carePlanIds = [...carePlans.keys()];
  const procedureIds = [...ctx.procedures.values()]
    .filter((p) => p.basedOn?.some((b) => carePlans.has(b.reference?.replace(/^CarePlan\//, "") ?? "")))
    .map((p) => p.id)
    .filter((id): id is string => Boolean(id));
  const goalIds = [
    ...new Set(
      [...carePlans.values()].flatMap((cp) => (cp.goal ?? []).map((g) => g.reference?.replace(/^Goal\//, "") ?? "")),
    ),
  ].filter(Boolean);
  return { blockers: [...new Set(blockers)], orders, carePlanIds, procedureIds, goalIds };
}

/** 計画の木を消す transaction(オーダーは種別ごとの削除で先に消しておく)。 */
export function buildPathwayTreeDeleteBundle(plan: PathwayCancelPlan): fhir4.Bundle {
  const del = (type: string, id: string): fhir4.BundleEntry => ({ request: { method: "DELETE", url: `${type}/${id}` } });
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...plan.procedureIds.map((id) => del("Procedure", id)),
      ...plan.carePlanIds.map((id) => del("CarePlan", id)),
      ...plan.goalIds.map((id) => del("Goal", id)),
    ],
  };
}
