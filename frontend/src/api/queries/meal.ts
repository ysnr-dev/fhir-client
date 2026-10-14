import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_VITAL_THRESHOLDS } from "../../fhir/vitalHelpers";
import { serviceRequestsOf } from "../../fhir/labOrderHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { DEFAULT_PRESCRIPTION_CATEGORY } from "../../fhir/prescriptionHelpers";
import { DEFAULT_MEDICATION_SCHEDULE } from "../../fhir/medicationScheduleHelpers";
import {
  DEFAULT_MEAL_SCHEDULE,
  isMealServiceRequest,
  MEAL_ORDER_TYPE,
  mealOrderServesOnOrAfter,
} from "../../fhir/mealOrderHelpers";
import { isActiveFoodAllergy, mealAllergyRefOf } from "../../fhir/mealAllergyHelpers";
import {
  cancelMealAllergyCheckEntries,
  completeMealAllergyCheckEntries,
  MEAL_ALLERGY_CHECK_TASK_CODE,
  mealAllergyCheckEntries,
} from "../../fhir/mealAllergyTaskHelpers";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { today } from "../../lib/dates";
import { postBundle, searchResource } from "../fhirClient";
import { NOTIFICATION_TASK_KEY, resourcesOfType, searchAllPages, setOrderPeriod } from "./core";
import { useCreatePrescription } from "./labResult";
import { useFacilitySettings } from "./organization";
import { invalidateProvenance, useOrderEnterer, useWithOrderProvenance } from "./provenance";
import { invalidateOrderDependents, postOrderDeleteBundle } from "./orderDelete";

// ---- 食事オーダー ----
//
// 明細も進捗 Task も持たないので、どの問い合わせも ServiceRequest 1 本で済む。

export function useMealOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);

  return useQuery({
    queryKey: ["ServiceRequest", "detail", "meal-order", srId],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

/**
 * まだ続いている食事オーダー。食事変更のときに前のオーダーを終了させるため、
 * 新規登録の画面が「今どの食事が出ているか」を出すのに使う。
 */
export function useActiveMealOrders(patientId: string | undefined, at: string) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, at, at);
  params.set("_sort", "-authoredon");
  params.set("_count", "20");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "meal-active", patientId, at],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>(
        "ServiceRequest",
        params,
      );
      return serviceRequestsOf(bundle).filter(isMealServiceRequest);
    },
    enabled: Boolean(patientId) && Boolean(at),
  });
}

/**
 * その患者の有効な食事オーダー。退院で止める対象を選ぶのに使う。
 *
 * useActiveMealOrders と違って基準日を取らないのは、退院日を打ち替えるたびに
 * 引き直したくないため。どれを止めるかは退院日とその日のどの食事までかで決まるので、
 * 絞り込み(mealOrderNeedsStop)は画面側で行う。
 */
export async function fetchPatientMealOrders(patientId: string): Promise<fhir4.ServiceRequest[]> {
  const params = new URLSearchParams();
  params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
  params.set("status", "active");
  // 新しい順。まだ続いているオーダーは必ずこの中に入るので 1 ページで足りる。
  params.set("_sort", "-authoredon");
  params.set("_count", "50");
  const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
  return serviceRequestsOf(bundle).filter(isMealServiceRequest);
}

export function usePatientMealOrders(patientId: string | undefined) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "meal-patient", patientId],
    queryFn: () => fetchPatientMealOrders(patientId as string),
    enabled: Boolean(patientId),
  });
}

/** 施設の食事提供時刻。設定が読めるまでは既定値(08/12/18)で動く。 */
export function useMealSchedule() {
  const settings = useFacilitySettings();
  return settings.data?.meal_schedule ?? DEFAULT_MEAL_SCHEDULE;
}

/** 内服の与薬時刻(食前・食後のずらしと就寝前・起床時)。設定が読めるまでは既定値。 */
export function useMedicationSchedule() {
  const settings = useFacilitySettings();
  return settings.data?.medication_schedule ?? DEFAULT_MEDICATION_SCHEDULE;
}

/**
 * 処方区分の初期値(入外区分ごと)。処方フォームを開いたときと、入外区分を選び直した
 * ときの値に使う。設定が読めるまでは未選択(既定値)。
 */
export function usePrescriptionCategoryDefaults() {
  const settings = useFacilitySettings();
  return {
    defaults: settings.data?.prescription_category ?? DEFAULT_PRESCRIPTION_CATEGORY,
    /** 設定を読み終えたか。フォームの初期値は初回描画時にしか効かないので、呼び出し側は
     *  これが true になるまでフォームを描かない。 */
    ready: !settings.isLoading,
  };
}

const EMPTY_CONSULT_DEFAULT_TEMPLATES: Record<string, string> = {};

/** 他科依頼の依頼目的テンプレートの既定(依頼先の診療科 Organization.id → canonical)。 */
export function useConsultDefaultTemplates() {
  const settings = useFacilitySettings();
  return settings.data?.consult_default_templates ?? EMPTY_CONSULT_DEFAULT_TEMPLATES;
}

/** 経過表でバイタルを異常値として強調するしきい値。設定が読めるまでは既定値で判定する。 */
export function useVitalThresholds() {
  const settings = useFacilitySettings();
  return settings.data?.vital_thresholds ?? DEFAULT_VITAL_THRESHOLDS;
}

/**
 * カレンダーに出す 1 か月ぶんの食事オーダー。
 *
 * 食事は開始したら次の指示まで続くので、その月に始まったものだけでは足りない
 * (前の月から続いているオーダーがその月の食事を決めていることがある)。
 * その月に掛かっている(月末までに始まり、月初より前に終わっていない)オーダーを引く。
 */
export function useMealOrderMonth(patientId: string | undefined, monthStart: string, monthEnd: string) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, monthStart, monthEnd);
  // 1 患者の食事オーダーは入院 1 回でせいぜい数十件なので 1 ページで足りる。
  params.set("_count", "100");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "meal-month", patientId, monthStart, monthEnd],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      return serviceRequestsOf(bundle).filter(isMealServiceRequest);
    },
    enabled: Boolean(patientId) && Boolean(monthStart) && Boolean(monthEnd),
  });
}

/**
 * その日に掛かっている全患者の食事オーダー(給食部門の食事一覧・食数集計)。
 * 終了は上流の order-period が終了拡張まで見て絞るので、その日に出す食事のオーダーだけが返る。
 * 食数の合計に使うので、上限で欠けたら投げる(complete)。
 */
export function useMealOrdersOn(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "meal-day", date],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
      params.set("status", "active");
      setOrderPeriod(params, date, date);
      const { matches } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
        page: 500,
        maxPages: 4,
        complete: true,
        signal,
      });
      return matches.filter(isMealServiceRequest);
    },
    enabled: Boolean(date),
  });
}

/**
 * 食事オーダーの登録・更新に渡すもの。orderIds は保存するオーダーと、食事変更で終了させる
 * オーダーの id。allergyIds は新しいオーダーに写した食物アレルギーの id。この 2 つで、
 * 「そのオーダーにそのアレルギーが反映されていない」通知を同じ transaction で閉じる。
 */
export interface MealOrderSave {
  bundle: fhir4.Bundle;
  patientId: string;
  orderIds: string[];
  allergyIds: string[];
}

/** その患者の未対応の「食事のアレルギー確認」の通知。 */
export async function fetchOpenMealAllergyChecks(patientId: string): Promise<fhir4.Task[]> {
  const params = new URLSearchParams();
  params.set("code", `${TASK_CODE_SYSTEM}|${MEAL_ALLERGY_CHECK_TASK_CODE.code}`);
  params.set("subject", `Patient/${patientId}`);
  params.set("status", "requested");
  params.set("_count", "50");
  const { data: bundle } = await searchResource<fhir4.Task>("Task", params);
  return resourcesOfType<fhir4.Task>(bundle, "Task");
}

/**
 * 保存の Bundle に、反映が済んだアレルギー確認の通知を閉じる entry を足す。
 * 写したアレルギーが無ければ通知を引かない(読み直しを増やさない)。
 */
function useWithMealAllergyCheckCompletion(): (save: MealOrderSave) => Promise<fhir4.Bundle> {
  const enterer = useOrderEnterer();
  return async (save) => {
    if (!enterer || save.allergyIds.length === 0 || save.orderIds.length === 0) return save.bundle;
    const tasks = await fetchOpenMealAllergyChecks(save.patientId);
    const entries = completeMealAllergyCheckEntries(tasks, enterer, save);
    if (entries.length === 0) return save.bundle;
    return { ...save.bundle, entry: [...(save.bundle.entry ?? []), ...entries] };
  };
}

/** 食事オーダーの登録。他のオーダーと同じ道(来歴付き)に、アレルギー確認の通知の自動完了を足す。 */
export function useCreateMealOrder() {
  const queryClient = useQueryClient();
  const create = useCreatePrescription();
  const withCompletion = useWithMealAllergyCheckCompletion();
  return useMutation({
    mutationFn: async (save: MealOrderSave) => create.mutateAsync(await withCompletion(save)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

export function useUpdateMealOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  const withCompletion = useWithMealAllergyCheckCompletion();
  return useMutation({
    mutationFn: async (save: MealOrderSave) => postBundle(withProvenance(await withCompletion(save))),
    onSuccess: () => {
      // 開始日が動くとカードの載る日も変わるので、まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * アレルギーの保存の Bundle に足す、食事オーダーあての通知の entry。
 *
 * - 有効な食物アレルギーなら、今日以降も食事を出す進行中のオーダーのうち、このアレルギーを
 *   写していないものへ「食事のアレルギー確認」を作る(同じ組み合わせの未対応があれば作らない)
 * - 有効でなくなった(解消・否定)なら、このアレルギーの未対応の通知を取り下げる
 *
 * allergyReference は保存済みなら `AllergyIntolerance/{id}`、新規なら Bundle 内の urn:uuid。
 */
export async function mealAllergyCheckEntriesFor(
  allergy: fhir4.AllergyIntolerance,
  allergyReference: string,
  patientId: string,
  requester?: { practitionerId: string; display: string },
): Promise<fhir4.BundleEntry[]> {
  const food = allergy.category?.includes("food");
  if (!food) return [];
  if (!isActiveFoodAllergy(allergy)) {
    if (!allergy.id) return [];
    return cancelMealAllergyCheckEntries(await fetchOpenMealAllergyChecks(patientId), allergy.id);
  }
  const [orders, tasks] = await Promise.all([
    fetchPatientMealOrders(patientId),
    fetchOpenMealAllergyChecks(patientId),
  ]);
  const day = today();
  return mealAllergyCheckEntries(
    {
      allergyReference,
      allergyName: mealAllergyRefOf(allergy).name,
      high: allergy.criticality === "high",
      patientId,
      requester,
    },
    orders.filter((sr) => mealOrderServesOnOrAfter(sr, day)),
    tasks,
  );
}

/**
 * useDeleteMealOrder の本体(読み直しの指示を伴わない)。明細も予約も持たないので、ヘッダ 1 件と
 * それを指す Task を消す。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteMealOrderRequest = (srId: string) =>
  postOrderDeleteBundle({
    resourceType: "Bundle",
    type: "transaction",
    entry: [{ request: { method: "DELETE", url: `ServiceRequest/${srId}` } }],
  });

export function useDeleteMealOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMealOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      invalidateOrderDependents(queryClient);
    },
  });
}
