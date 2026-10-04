import type { ProblemRef } from "./conditionHelpers";
import { isConsultServiceRequest, consultOrderProblem } from "./consultOrderHelpers";
import { isEndoscopyServiceRequest, endoscopyOrderProblem } from "./endoscopyOrderHelpers";
import { isLabServiceRequest, labOrderProblem } from "./labOrderHelpers";
import { isMealServiceRequest, mealOrderProblem } from "./mealOrderHelpers";
import { isMicroServiceRequest, microOrderProblem } from "./microOrderHelpers";
import { isNutritionGuidanceServiceRequest, nutritionGuidanceOrderProblem } from "./nutritionGuidanceOrderHelpers";
import { isPathoServiceRequest, pathoOrderProblem } from "./pathoOrderHelpers";
import { isPhysioServiceRequest, physioOrderProblem } from "./physioOrderHelpers";
import { isRadServiceRequest, radOrderProblem } from "./radOrderHelpers";
import { isRadiotherapyServiceRequest, radiotherapyOrderProblem } from "./radiotherapyOrderHelpers";
import { isRehabServiceRequest, rehabOrderProblem } from "./rehabOrderHelpers";
import { isSurgeryServiceRequest, surgeryOrderProblem } from "./surgeryOrderHelpers";
import { isTransfusionServiceRequest, transfusionOrderProblem } from "./transfusionOrderHelpers";
import { isTreatmentServiceRequest, treatmentOrderProblem } from "./treatmentOrderHelpers";

// 部門オーダーの種別ごとの対応表(FHIR の読み方だけ。画面での見せ方は
// components/orderKindRegistry.tsx)。種別を足すときはここに 1 行足す ——
// カルテの種別名・ヘッダからの種別判定・プロブレムの読み出し・URL の種別はここから回る。
//
// 処方と注射は入っていない。どの種別にも当たらない ServiceRequest が処方、という
// 判定の順序があり、レジメンの印などカードの組み立ても別なので karteTimeline が直接扱う。

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
  "consult-order",
] as const;

export type OrderKind = (typeof ORDER_KINDS)[number];

interface OrderKindCore {
  /** カルテの種別バッジ・種別フィルタに出す名前。 */
  label: string;
  /** オーダーのヘッダ ServiceRequest がこの種別か。 */
  matches(sr: fhir4.ServiceRequest): boolean;
  /** オーダーが対象とするプロブレム。 */
  problem(sr: fhir4.ServiceRequest): ProblemRef | null;
}

export const ORDER_KIND_CORE: Record<OrderKind, OrderKindCore> = {
  "lab-order": { label: "検体検査", matches: isLabServiceRequest, problem: labOrderProblem },
  "micro-order": { label: "細菌検査", matches: isMicroServiceRequest, problem: microOrderProblem },
  "patho-order": { label: "病理検査", matches: isPathoServiceRequest, problem: pathoOrderProblem },
  "rad-order": { label: "放射線検査", matches: isRadServiceRequest, problem: radOrderProblem },
  "physio-order": { label: "生理検査", matches: isPhysioServiceRequest, problem: physioOrderProblem },
  "endoscopy-order": { label: "内視鏡", matches: isEndoscopyServiceRequest, problem: endoscopyOrderProblem },
  "treatment-order": { label: "処置", matches: isTreatmentServiceRequest, problem: treatmentOrderProblem },
  "surgery-order": { label: "手術", matches: isSurgeryServiceRequest, problem: surgeryOrderProblem },
  "meal-order": { label: "食事", matches: isMealServiceRequest, problem: mealOrderProblem },
  "transfusion-order": { label: "輸血", matches: isTransfusionServiceRequest, problem: transfusionOrderProblem },
  "rehab-order": { label: "リハビリ", matches: isRehabServiceRequest, problem: rehabOrderProblem },
  "radiotherapy-order": { label: "放射線治療", matches: isRadiotherapyServiceRequest, problem: radiotherapyOrderProblem },
  "nutrition-guidance-order": { label: "栄養指導", matches: isNutritionGuidanceServiceRequest, problem: nutritionGuidanceOrderProblem },
  "consult-order": { label: "他科依頼", matches: isConsultServiceRequest, problem: consultOrderProblem },
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
