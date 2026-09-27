import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_VITAL_THRESHOLDS } from "../../fhir/vitalHelpers";
import { serviceRequestsOf } from "../../fhir/labOrderHelpers";
import { DEFAULT_PRESCRIPTION_CATEGORY, ORDER_TYPE_SYSTEM } from "../../fhir/prescriptionHelpers";
import { DEFAULT_MEDICATION_SCHEDULE } from "../../fhir/medicationScheduleHelpers";
import { DEFAULT_MEAL_SCHEDULE, isMealServiceRequest, MEAL_ORDER_TYPE } from "../../fhir/mealOrderHelpers";
import { deleteResource, postBundle, searchResource } from "../fhirClient";
import { setOrderPeriod } from "./core";
import { useFacilitySettings } from "./organization";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";

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

export function useUpdateMealOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      // 開始日が動くとカードの載る日も変わるので、まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * useDeleteMealOrder の本体(読み直しの指示を伴わない)。明細も予約も持たないので、ヘッダ 1 件を
 * 消すだけ。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteMealOrderRequest = (srId: string) => deleteResource("ServiceRequest", srId);

export function useDeleteMealOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMealOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}
