import type { ProblemRef } from "./conditionHelpers";
import { isConsultServiceRequest, consultOrderProblem, CONSULT_ORDER_TYPE } from "./consultOrderHelpers";
import { isEndoscopyServiceRequest, endoscopyOrderProblem, ENDOSCOPY_ORDER_TYPE } from "./endoscopyOrderHelpers";
import { isLabServiceRequest, labOrderProblem, LAB_ORDER_TYPE } from "./labOrderHelpers";
import { isMealServiceRequest, mealOrderProblem, MEAL_ORDER_TYPE } from "./mealOrderHelpers";
import { isMicroServiceRequest, microOrderProblem, MICRO_ORDER_TYPE } from "./microOrderHelpers";
import { isNutritionGuidanceServiceRequest, nutritionGuidanceOrderProblem, NUTRITION_GUIDANCE_ORDER_TYPE } from "./nutritionGuidanceOrderHelpers";
import { isMedicationGuidanceServiceRequest, medicationGuidanceOrderProblem, MEDICATION_GUIDANCE_ORDER_TYPE } from "./medicationGuidanceOrderHelpers";
import { isPathoServiceRequest, pathoOrderProblem, PATHO_ORDER_TYPE } from "./pathoOrderHelpers";
import { isPhysioServiceRequest, physioOrderProblem, PHYSIO_ORDER_TYPE } from "./physioOrderHelpers";
import { isRadServiceRequest, radOrderProblem, RAD_ORDER_TYPE } from "./radOrderHelpers";
import { isRadiotherapyServiceRequest, radiotherapyOrderProblem, RADIOTHERAPY_ORDER_TYPE } from "./radiotherapyOrderHelpers";
import { isRehabServiceRequest, rehabOrderProblem, REHAB_ORDER_TYPE } from "./rehabOrderHelpers";
import { isSurgeryServiceRequest, surgeryOrderProblem, SURGERY_ORDER_TYPE } from "./surgeryOrderHelpers";
import { isTransfusionServiceRequest, transfusionOrderProblem, TRANSFUSION_ORDER_TYPE } from "./transfusionOrderHelpers";
import { isTreatmentServiceRequest, treatmentOrderProblem, TREATMENT_ORDER_TYPE } from "./treatmentOrderHelpers";

// 部門オーダーの種別ごとの対応表(FHIR の読み方だけ。画面での見せ方は
// components/orderKindRegistry.tsx)。種別を足すときはここに 1 行足す ——
// カルテの種別名・ヘッダからの種別判定・プロブレムの読み出し・URL の種別はここから回る。
//
// 処方と注射は入っていない。レジメンの印などカードの組み立てが別なので karteTimeline が直接扱う。

export const ORDER_KINDS = [
  "lab-order",
  "micro-order",
  "patho-order",
  "rad-order",
  "physio-order",
  "endoscopy-order",
  "treatment-order",
  "surgery-order",
  "meal-order",
  "transfusion-order",
  "rehab-order",
  "radiotherapy-order",
  "nutrition-guidance-order",
  "medication-guidance-order",
  "consult-order",
] as const;

export type OrderKind = (typeof ORDER_KINDS)[number];

interface OrderKindCore {
  /** カルテの種別バッジ・種別フィルタに出す名前。 */
  label: string;
  /** ヘッダの category に入る order-type のコード。 */
  orderType: { code: string; display: string };
  /** オーダーのヘッダ ServiceRequest がこの種別か。 */
  matches(sr: fhir4.ServiceRequest): boolean;
  /** オーダーが対象とするプロブレム。 */
  problem(sr: fhir4.ServiceRequest): ProblemRef | null;
}

export const ORDER_KIND_CORE: Record<OrderKind, OrderKindCore> = {
  "lab-order": { label: "検体検査", orderType: LAB_ORDER_TYPE, matches: isLabServiceRequest, problem: labOrderProblem },
  "micro-order": { label: "細菌検査", orderType: MICRO_ORDER_TYPE, matches: isMicroServiceRequest, problem: microOrderProblem },
  "patho-order": { label: "病理検査", orderType: PATHO_ORDER_TYPE, matches: isPathoServiceRequest, problem: pathoOrderProblem },
  "rad-order": { label: "放射線検査", orderType: RAD_ORDER_TYPE, matches: isRadServiceRequest, problem: radOrderProblem },
  "physio-order": { label: "生理検査", orderType: PHYSIO_ORDER_TYPE, matches: isPhysioServiceRequest, problem: physioOrderProblem },
  "endoscopy-order": { label: "内視鏡", orderType: ENDOSCOPY_ORDER_TYPE, matches: isEndoscopyServiceRequest, problem: endoscopyOrderProblem },
  "treatment-order": { label: "処置", orderType: TREATMENT_ORDER_TYPE, matches: isTreatmentServiceRequest, problem: treatmentOrderProblem },
  "surgery-order": { label: "手術", orderType: SURGERY_ORDER_TYPE, matches: isSurgeryServiceRequest, problem: surgeryOrderProblem },
  "meal-order": { label: "食事", orderType: MEAL_ORDER_TYPE, matches: isMealServiceRequest, problem: mealOrderProblem },
  "transfusion-order": { label: "輸血", orderType: TRANSFUSION_ORDER_TYPE, matches: isTransfusionServiceRequest, problem: transfusionOrderProblem },
  "rehab-order": { label: "リハビリ", orderType: REHAB_ORDER_TYPE, matches: isRehabServiceRequest, problem: rehabOrderProblem },
  "radiotherapy-order": { label: "放射線治療", orderType: RADIOTHERAPY_ORDER_TYPE, matches: isRadiotherapyServiceRequest, problem: radiotherapyOrderProblem },
  "nutrition-guidance-order": { label: "栄養指導", orderType: NUTRITION_GUIDANCE_ORDER_TYPE, matches: isNutritionGuidanceServiceRequest, problem: nutritionGuidanceOrderProblem },
  "medication-guidance-order": { label: "服薬指導", orderType: MEDICATION_GUIDANCE_ORDER_TYPE, matches: isMedicationGuidanceServiceRequest, problem: medicationGuidanceOrderProblem },
  "consult-order": { label: "他科依頼", orderType: CONSULT_ORDER_TYPE, matches: isConsultServiceRequest, problem: consultOrderProblem },
};

export const ORDER_KIND_LABELS = Object.fromEntries(
  ORDER_KINDS.map((kind) => [kind, ORDER_KIND_CORE[kind].label]),
) as Record<OrderKind, string>;

export function isOrderKind(kind: string): kind is OrderKind {
  return (ORDER_KINDS as readonly string[]).includes(kind);
}

/** ヘッダ ServiceRequest の部門オーダー種別。どれにも当たらなければ null(処方・注射など)。 */
export function departmentOrderKindOf(sr: fhir4.ServiceRequest): OrderKind | null {
  return ORDER_KINDS.find((kind) => ORDER_KIND_CORE[kind].matches(sr)) ?? null;
}
