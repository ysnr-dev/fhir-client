import { mealOrderAllergies, mealOrderDietName, mealPointLabel } from "./mealOrderHelpers";
import {
  buildCancelledNotificationTask,
  buildCompletedNotificationTask,
  buildNotificationTask,
  completeNotificationEntry,
  hasTaskCode,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";

// 食事のアレルギー確認の通知(docs/meal-order-design.md §2.12)。
//
//   ServiceRequest(食事オーダー) ← focus ── Task[meal-allergy-check](owner = オーダーの依頼医)
//
// 食物アレルギーが登録(または有効化)されたとき、進行中の食事オーダーがそのアレルギーを
// 写していなければ、アレルギーの保存と同じ transaction で作る。オーダー 1 件 × アレルギー 1 件に
// つき 1 通知。食事オーダーを登録し直してアレルギーが写れば自動で閉じる。

export const MEAL_ALLERGY_CHECK_TASK_CODE = {
  code: "meal-allergy-check",
  display: "食事のアレルギー確認",
};

/** 対応済みにしたときに通知へ残す文。 */
export const MEAL_ALLERGY_CHECK_NOTE = "食物アレルギーと食事オーダーを確認しました。";

const ALLERGY_INPUT = "アレルギー";
const ALLERGY_NAME_INPUT = "アレルゲン";
const ORDER_INPUT = "食事オーダー";
const START_DATE_INPUT = "開始日";

export function isMealAllergyCheckTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, MEAL_ALLERGY_CHECK_TASK_CODE.code);
}

export function mealAllergyCheckAllergyId(task: fhir4.Task): string {
  return taskInputOf(task, ALLERGY_INPUT)?.valueReference?.reference?.split("/").pop() ?? "";
}

export function mealAllergyCheckOrderId(task: fhir4.Task): string {
  return task.focus?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1] ?? "";
}

/** 通知の本文と一覧に出す、オーダーの短い言い方「一般食2000kcal 10/14 朝〜」。 */
export function mealOrderShortLabel(sr: fhir4.ServiceRequest): string {
  const start = mealPointLabel(sr.occurrenceDateTime ?? "");
  return [mealOrderDietName(sr), start ? `${start}〜` : ""].filter(Boolean).join(" ");
}

export interface MealAllergyCheckSource {
  /** アレルギーの参照。同じ transaction で作るなら urn:uuid(上流が解決する)。 */
  allergyReference: string;
  allergyName: string;
  /** 重篤化リスクが高いか。通知の強度を上げる。 */
  high: boolean;
  patientId: string;
  /** 通知を発生させた人(アレルギーを登録した人)。 */
  requester?: { practitionerId: string; display: string };
}

/**
 * 進行中の食事オーダーのうち、このアレルギーを写していないものへの通知。
 * 同じオーダー × 同じアレルギーの未対応の通知が既にあれば作らない。
 */
export function mealAllergyCheckEntries(
  source: MealAllergyCheckSource,
  orders: fhir4.ServiceRequest[],
  existing: fhir4.Task[],
): fhir4.BundleEntry[] {
  const allergyId = source.allergyReference.split("/").pop() ?? "";
  const entries: fhir4.BundleEntry[] = [];
  for (const sr of orders) {
    if (!sr.id) continue;
    if (mealOrderAllergies(sr).some((ref) => ref.id === allergyId)) continue;
    const duplicated = existing.some(
      (task) =>
        task.status === "requested" &&
        mealAllergyCheckOrderId(task) === sr.id &&
        mealAllergyCheckAllergyId(task) === allergyId,
    );
    if (duplicated) continue;

    const task = buildNotificationTask({
      code: MEAL_ALLERGY_CHECK_TASK_CODE,
      severity: source.high ? "alert" : "caution",
      focusReference: `ServiceRequest/${sr.id}`,
      patientId: source.patientId,
      owner: sr.requester,
      requester: source.requester
        ? {
            reference: `Practitioner/${source.requester.practitionerId}`,
            display: source.requester.display,
          }
        : undefined,
      basedOn: [{ reference: `ServiceRequest/${sr.id}` }],
      description: `食物アレルギー「${source.allergyName}」が登録されました。食事オーダー(${mealOrderShortLabel(sr)})に反映されていません`,
      input: [
        {
          type: { text: ALLERGY_INPUT },
          valueReference: { reference: source.allergyReference, display: source.allergyName },
        },
        { type: { text: ALLERGY_NAME_INPUT }, valueString: source.allergyName },
        { type: { text: ORDER_INPUT }, valueString: mealOrderShortLabel(sr) },
        ...(sr.occurrenceDateTime
          ? [{ type: { text: START_DATE_INPUT }, valueDate: sr.occurrenceDateTime.slice(0, 10) }]
          : []),
      ],
    });
    if (sr.encounter) task.encounter = sr.encounter;
    entries.push(notificationTaskEntry(task));
  }
  return entries;
}

/**
 * 食事オーダーを保存したときに自動で閉じる通知。対象は「焦点が保存した(または食事変更で
 * 終了させた)オーダー」で、「そのアレルギーが新しいオーダーに写った」もの。
 */
export function completeMealAllergyCheckEntries(
  tasks: fhir4.Task[],
  actor: { practitionerId: string; display: string },
  saved: { orderIds: string[]; allergyIds: string[] },
): fhir4.BundleEntry[] {
  return tasks
    .filter(
      (task) =>
        task.id &&
        task.status === "requested" &&
        isMealAllergyCheckTask(task) &&
        saved.orderIds.includes(mealAllergyCheckOrderId(task)) &&
        saved.allergyIds.includes(mealAllergyCheckAllergyId(task)),
    )
    .map((task) =>
      completeNotificationEntry(buildCompletedNotificationTask(task, actor, MEAL_ALLERGY_CHECK_NOTE)),
    );
}

/** アレルギーが解消・否定・削除されて確認の要らない事象になったとき、通知を取り下げる。 */
export function cancelMealAllergyCheckEntries(tasks: fhir4.Task[], allergyId: string): fhir4.BundleEntry[] {
  return tasks
    .filter(
      (task) =>
        task.id &&
        task.status === "requested" &&
        isMealAllergyCheckTask(task) &&
        mealAllergyCheckAllergyId(task) === allergyId,
    )
    .map((task) => completeNotificationEntry(buildCancelledNotificationTask(task)));
}

export interface MealAllergyCheckRow extends NotificationRowBase {
  orderSrId: string;
  allergyId: string;
  allergyName: string;
  orderLabel: string;
  startDate: string;
}

export function mealAllergyCheckRowOf(
  task: fhir4.Task,
  patient: fhir4.Patient | undefined,
): MealAllergyCheckRow {
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    orderSrId: mealAllergyCheckOrderId(task),
    allergyId: mealAllergyCheckAllergyId(task),
    allergyName: taskInputOf(task, ALLERGY_NAME_INPUT)?.valueString ?? "",
    orderLabel: taskInputOf(task, ORDER_INPUT)?.valueString ?? "",
    startDate: taskInputOf(task, START_DATE_INPUT)?.valueDate ?? "",
  };
}
