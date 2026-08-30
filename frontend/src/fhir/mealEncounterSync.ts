import {
  buildMealOrderCloseEntry,
  buildMealOrderCreateEntry,
  buildMealOrderResumeEntry,
  buildMealOrderRestoreEntry,
  buildMealOrderRewriteEntry,
  emptyMealOrderForm,
  firstMealAtOrAfter,
  isSameEndCauseFamily,
  lastMealAtOrBefore,
  mealOrderEnd,
  mealOrderEncounterId,
  mealOrderEndCause,
  mealOrderLink,
  mealPointKey,
  mealPointKeyOf,
  nextMealPoint,
  parseMealPoint,
  previousMealPoint,
  type MealItemRef,
  type MealOrderEndReason,
  type MealPoint,
  type MealScheduleSettings,
} from "./mealOrderHelpers";
import { mealStapleText, summarizeMealOrder } from "./mealOrderHelpers";
import type { LeaveValues } from "./encounterHelpers";
import type { OrderAttribution } from "./prescriptionHelpers";

// 入退院・外出泊と食事オーダーの連動。
//
// 入院(Encounter)の書き換えと同じ transaction に載せる食事オーダーのエントリを組む。
// ここは純関数で、画面(モーダル・行メニュー)が「その患者の有効な食事オーダー」と
// 施設の食事提供時刻を渡し、返ったエントリを buildEncounterUpdateBundle の第 2 引数に足す。
//
// 決まりごと:
// - 「どの食事まで出すか」は出発・退院の時刻までに提供済みの最後の食事
//   (lastMealAtOrBefore)、「どの食事から戻すか」は帰院の時刻以降に出る最初の食事
//   (firstMealAtOrAfter)。手で選ばせない。
// - 連動で書いた終了には理由(meal-order-end-reason)と上書き前の終了を残し、取消では
//   理由が一致するオーダーだけを上書き前に戻す。手で入れた終了は触らない。
// - 退院予定 → 予定の変更 → 退院実施 は同じ系統として扱い、何度上書きしても
//   「連動の前の終了」を保つ(isSameEndCauseFamily)。
// - 外出泊は食止めオーダー(kind=leave-fasting)と再開オーダー(kind=resume)を外出泊 id で
//   結び付け、取消では両方を消して元のオーダーを戻す。

export interface MealSyncContext {
  /** その患者の有効な食事オーダー(usePatientMealOrders)。 */
  orders: fhir4.ServiceRequest[];
  patientId: string;
  encounterId: string;
  schedule: MealScheduleSettings;
  /** 連動で作るオーダーの登録者(依頼科・病棟)。 */
  requester: OrderAttribution;
  /** 食止めの食種(マスタの is_fasting)。無ければ外出泊で食止めオーダーは作らない。 */
  fastingDiet?: MealItemRef | null;
}

/** この入院のオーダーか(入院との結びつきを持たない旧データは患者のものとして含める)。 */
function belongsTo(sr: fhir4.ServiceRequest, encounterId: string): boolean {
  const id = mealOrderEncounterId(sr);
  return !id || id === encounterId;
}

function pointKey(point: MealPoint): string {
  return mealPointKey(point.date, point.timing);
}

function startKey(sr: fhir4.ServiceRequest): string {
  return mealPointKeyOf(sr.occurrenceDateTime ?? "");
}

/**
 * 連動で止める前の終了。同じ系統の理由で既に止めていれば、その上書き前の終了。
 * 空なら継続。
 */
function baseEnd(sr: fhir4.ServiceRequest, cause: Pick<MealOrderEndCauseLike, "reason" | "leaveId">): string {
  const current = mealOrderEndCause(sr);
  return current && isSameEndCauseFamily(current, cause) ? current.previousEnd : mealOrderEnd(sr);
}

type MealOrderEndCauseLike = { reason: MealOrderEndReason; leaveId?: string };

/** 終了(空なら継続)が point より後まで続くか。 */
function endsAfter(end: string, point: MealPoint): boolean {
  return !end || mealPointKeyOf(end) > pointKey(point);
}

// ---- 退院・退院予定 ----

/**
 * 退院予定の登録・変更、退院の実施。退院時刻までに出た最後の食事で止める。
 * 予定で止めたあとに予定日が動いたときは、連動の前の終了を基準に立て直す
 * (新しい退院より前に元々終わるオーダーなら、予定の終了を外して元に戻す)。
 */
export function buildDischargeSyncEntries(
  ctx: MealSyncContext,
  dischargeAt: string,
  reason: "discharge-plan" | "discharge",
): fhir4.BundleEntry[] {
  const point = lastMealAtOrBefore(dischargeAt, ctx.schedule);
  const cause = { reason };
  const entries: fhir4.BundleEntry[] = [];
  for (const sr of ctx.orders) {
    if (!belongsTo(sr, ctx.encounterId)) continue;
    const current = mealOrderEndCause(sr);
    const sameFamily = Boolean(current && isSameEndCauseFamily(current, cause));
    if (endsAfter(baseEnd(sr, cause), point)) {
      entries.push(buildMealOrderCloseEntry(sr, point.date, point.timing, cause));
    } else if (sameFamily) {
      entries.push(buildMealOrderRestoreEntry(sr));
    }
  }
  return entries;
}

/** 退院予定の取消・退院取消。その理由で止めたオーダーを、止める前の終了に戻す。 */
export function buildDischargeRestoreEntries(
  ctx: MealSyncContext,
  reasons: MealOrderEndReason[],
): fhir4.BundleEntry[] {
  return ctx.orders
    .filter((sr) => belongsTo(sr, ctx.encounterId))
    .filter((sr) => {
      const cause = mealOrderEndCause(sr);
      return cause && reasons.includes(cause.reason);
    })
    .map((sr) => buildMealOrderRestoreEntry(sr));
}

/** 退院で止まる食事(画面の一覧用)。 */
export function dischargeStopPoint(ctx: MealSyncContext, dischargeAt: string): MealPoint {
  return lastMealAtOrBefore(dischargeAt, ctx.schedule);
}

// ---- 外出泊 ----

export interface LeaveSyncPreview {
  /** 食止めの区間。end が無ければ帰院まで継続。区間が無い(同じ食事の間に戻る)なら null。 */
  fasting: { start: MealPoint; end?: MealPoint } | null;
  /** 元の食事に戻す食事。帰院が未定なら null。 */
  resume: MealPoint | null;
  /** 止める(= 戻す先になる)オーダー。 */
  stopping: fhir4.ServiceRequest[];
}

/** 外出泊で止める食事・戻す食事(画面のプレビューと、実際の組み立ての両方が使う)。 */
export function previewLeaveSync(ctx: MealSyncContext, leave: LeaveValues): LeaveSyncPreview {
  const stop = lastMealAtOrBefore(leave.start, ctx.schedule);
  const resume = leave.end ? firstMealAtOrAfter(leave.end, ctx.schedule) : null;
  const cause = { reason: "leave" as const, leaveId: leave.id };
  const stopping = ctx.orders.filter((sr) => {
    if (!belongsTo(sr, ctx.encounterId)) return false;
    // 連動が自分で作った同じ外出泊のオーダーは対象外。
    if (mealOrderLink(sr)?.leaveId === leave.id) return false;
    // 帰院より後に始まる先のオーダーは触らない(止めて戻すと二重になる)。
    if (resume && startKey(sr) >= pointKey(resume)) return false;
    return endsAfter(baseEnd(sr, cause), stop);
  });
  const fastingStart = nextMealPoint(stop.date, stop.timing);
  const fastingEnd = resume ? previousMealPoint(resume.date, resume.timing) : undefined;
  const fasting =
    fastingEnd && pointKey(fastingEnd) < pointKey(fastingStart)
      ? null
      : { start: fastingStart, end: fastingEnd };
  return { fasting, resume, stopping };
}

/** 外出泊の登録。止める・食止めを出す・(帰院が決まっていれば)戻す、を一度に組む。 */
export function buildLeaveStartEntries(ctx: MealSyncContext, leave: LeaveValues): fhir4.BundleEntry[] {
  const preview = previewLeaveSync(ctx, leave);
  const stop = lastMealAtOrBefore(leave.start, ctx.schedule);
  const cause = { reason: "leave" as const, leaveId: leave.id };
  const entries: fhir4.BundleEntry[] = preview.stopping.map((sr) =>
    buildMealOrderCloseEntry(sr, stop.date, stop.timing, cause),
  );
  if (preview.fasting && ctx.fastingDiet) {
    entries.push(buildFastingEntry(ctx, leave, preview.fasting.start, preview.fasting.end));
  }
  if (preview.resume) {
    for (const sr of preview.stopping) {
      const entry = buildResumeEntry(ctx, sr, leave, preview.resume, cause);
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

/**
 * 帰院の実施(終了日時の確定)。食止めオーダーに終了を書き、再開オーダーを作る
 * (登録時に帰院予定があって既に作ってあれば、開始を動かす)。
 */
export function buildLeaveReturnEntries(ctx: MealSyncContext, leave: LeaveValues): fhir4.BundleEntry[] {
  if (!leave.end) return [];
  const resume = firstMealAtOrAfter(leave.end, ctx.schedule);
  const fastingEnd = previousMealPoint(resume.date, resume.timing);
  const cause = { reason: "leave" as const, leaveId: leave.id };
  const entries: fhir4.BundleEntry[] = [];

  const mine = ctx.orders.filter((sr) => mealOrderLink(sr)?.leaveId === leave.id);
  for (const sr of mine) {
    const link = mealOrderLink(sr);
    if (link?.kind === "leave-fasting") {
      // 戻りが早くて 1 食も止めないなら、食止めオーダーは要らない。
      if (pointKey(fastingEnd) < startKey(sr)) {
        entries.push({ request: { method: "DELETE", url: `ServiceRequest/${sr.id}` } });
      } else {
        entries.push(
          buildMealOrderRewriteEntry(sr, { endDate: fastingEnd.date, endTiming: fastingEnd.timing }),
        );
      }
    } else if (link?.kind === "resume") {
      entries.push(
        buildMealOrderRewriteEntry(sr, { startDate: resume.date, startTiming: resume.timing }),
      );
    }
  }

  const resumed = new Set(
    mine.filter((sr) => mealOrderLink(sr)?.kind === "resume").map((sr) => mealOrderLink(sr)?.sourceId),
  );
  for (const sr of ctx.orders) {
    const current = mealOrderEndCause(sr);
    if (!current || current.reason !== "leave" || current.leaveId !== leave.id) continue;
    if (resumed.has(sr.id)) continue;
    const entry = buildResumeEntry(ctx, sr, leave, resume, cause);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** 外出泊の取消。食止め・再開オーダーを消し、止めたオーダーを元に戻す。 */
export function buildLeaveCancelEntries(ctx: MealSyncContext, leaveId: string): fhir4.BundleEntry[] {
  const entries: fhir4.BundleEntry[] = [];
  for (const sr of ctx.orders) {
    if (mealOrderLink(sr)?.leaveId === leaveId) {
      entries.push({ request: { method: "DELETE", url: `ServiceRequest/${sr.id}` } });
      continue;
    }
    const cause = mealOrderEndCause(sr);
    if (cause?.reason === "leave" && cause.leaveId === leaveId) {
      entries.push(buildMealOrderRestoreEntry(sr));
    }
  }
  return entries;
}

function buildFastingEntry(
  ctx: MealSyncContext,
  leave: LeaveValues,
  start: MealPoint,
  end: MealPoint | undefined,
): fhir4.BundleEntry {
  const diet = ctx.fastingDiet as MealItemRef;
  return buildMealOrderCreateEntry(
    {
      ...emptyMealOrderForm(),
      diet,
      dietIsFasting: true,
      // 欠食理由は連動が決める(外出泊で出す食止めなので手で選ばせるところが無い)。
      fastingReason: "leave",
      startDate: start.date,
      startTiming: start.timing,
      endDate: end?.date ?? "",
      endTiming: end?.timing ?? "dinner",
      comment: leave.reason ? `外出泊(${leave.reason})` : "外出泊",
    },
    ctx.patientId,
    ctx.requester,
    { encounterId: ctx.encounterId, link: { kind: "leave-fasting", leaveId: leave.id } },
  );
}

/**
 * 元の食事へ戻す再開オーダー。終了は「連動で止める前の終了」を引き継ぐ。それが戻す食事より
 * 前なら(帰院前に元々終わる食事だったなら)戻す先が無いので作らない。
 */
function buildResumeEntry(
  ctx: MealSyncContext,
  sr: fhir4.ServiceRequest,
  leave: LeaveValues,
  resume: MealPoint,
  cause: MealOrderEndCauseLike,
): fhir4.BundleEntry | null {
  const base = baseEnd(sr, cause);
  if (base && mealPointKeyOf(base) < pointKey(resume)) return null;
  const end = base ? parseMealPoint(base) : undefined;
  return buildMealOrderResumeEntry(sr, resume.date, resume.timing, ctx.patientId, ctx.requester, {
    encounterId: ctx.encounterId,
    leaveId: leave.id,
    endDate: end?.date ?? "",
    endTiming: end?.timing,
  });
}

// ---- 画面向けの要約 ----

/**
 * 連動エントリを人が読める 1 行ずつにする(モーダルの「食事オーダーも一緒に…」の一覧)。
 * PUT は書き換え後の内容、POST は「新規」、DELETE は元のオーダーの内容で「取消」。
 */
export function describeMealSyncEntries(
  entries: fhir4.BundleEntry[],
  orders: fhir4.ServiceRequest[],
): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    const method = entry.request?.method;
    if (method === "DELETE") {
      const id = entry.request?.url?.split("/").pop();
      const sr = orders.find((o) => o.id === id);
      lines.push(`取消: ${sr ? orderLine(sr) : id}`);
      continue;
    }
    const sr = entry.resource as fhir4.ServiceRequest | undefined;
    if (!sr) continue;
    lines.push(`${method === "POST" ? "新規: " : ""}${orderLine(sr)}`);
  }
  return lines;
}

function orderLine(sr: fhir4.ServiceRequest): string {
  const summary = summarizeMealOrder(sr);
  // 食止めのオーダーには主食が無いので、そこに欠食理由を出す(「食止め(外泊) …」)。
  const detail = mealStapleText(summary) || summary.fastingReasonLabel;
  const range = `${summary.startLabel}〜${summary.endLabel ? ` ${summary.endLabel}` : " 継続"}`;
  return `${summary.dietName}${detail ? `(${detail})` : ""} ${range}`;
}
