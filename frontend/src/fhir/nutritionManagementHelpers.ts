import {
  admissionDocumentCells,
  encounterTemplateResponses,
  isCompleted,
  nutritionNeedOf,
  type AdmissionDocumentCell,
  type AdmissionDocumentSettings,
} from "./admissionDocumentHelpers";
import { responseAnswer } from "./conditionTemplateHelpers";
import { encounterBedId, encounterBedLabel, encounterPatientId } from "./encounterHelpers";
import { mealOrderOneLine } from "./mealOrderHelpers";
import { referenceId } from "./shared";

// 栄養管理の一覧(docs/nutrition-care-plan-design.md §6)。その日の入院患者ごとに、栄養スクリーニングの結果
// (MUST・GLIM・SGA)・特別な栄養管理の必要性・栄養管理計画書の状況・いまの食事を並べ、低栄養などの割合を数える。
// スクリーニングと計画書の状況・期限は入退院文書と同じ判定(admissionDocumentHelpers.ts)。

/** 確定した最新の栄養スクリーニングから読む結果(linkId は nutrition-screening-01 と同じ)。 */
export interface NutritionScreeningSummary {
  mustTotal: number | undefined;
  /** 「低」「中」「高」。 */
  mustRisk: string;
  /** 「低栄養」「該当なし」。 */
  glim: string;
  /** 「中等度」「重度」。 */
  glimSeverity: string;
  /** A / B / C。 */
  sga: string;
}

export const GLIM_MALNUTRITION = "低栄養";

export function summarizeNutritionScreening(response: fhir4.QuestionnaireResponse): NutritionScreeningSummary {
  return {
    mustTotal: responseAnswer(response, "must_total")?.valueInteger,
    mustRisk: responseAnswer(response, "must_risk")?.valueString ?? "",
    glim: responseAnswer(response, "glim_result")?.valueString ?? "",
    glimSeverity: responseAnswer(response, "glim_severity")?.valueCoding?.display ?? "",
    sga: responseAnswer(response, "sga_result")?.valueCoding?.code ?? "",
  };
}

export interface NutritionManagementBedWard {
  wardId: string;
  wardName: string;
}

export interface NutritionManagementRow {
  encounter: fhir4.Encounter;
  patientId: string;
  patient: fhir4.Patient | undefined;
  wardId: string;
  wardName: string;
  bedLabel: string;
  /** 確定した最新の栄養スクリーニングの結果。確定したものが無ければ null。 */
  screening: NutritionScreeningSummary | null;
  screeningCell: AdmissionDocumentCell;
  need: "yes" | "no" | "unknown";
  planCell: AdmissionDocumentCell;
  /** いまの食事(その日に続いている最新の食事オーダー)。無ければ空。 */
  meal: string;
}

export function buildNutritionManagementRows(input: {
  encounters: fhir4.Encounter[];
  patientsById: Map<string, fhir4.Patient>;
  responses: fhir4.QuestionnaireResponse[];
  mealOrders: fhir4.ServiceRequest[];
  bedWards: Map<string, NutritionManagementBedWard>;
  settings: AdmissionDocumentSettings;
  today: string;
}): NutritionManagementRow[] {
  const { encounters, patientsById, responses, mealOrders, bedWards, settings, today } = input;

  // 患者ごとの最新の食事オーダー(開始の新しいもの)。
  const mealByPatient = new Map<string, fhir4.ServiceRequest>();
  for (const order of mealOrders) {
    const patientId = referenceId(order.subject?.reference);
    if (!patientId) continue;
    const current = mealByPatient.get(patientId);
    if (!current || (order.occurrenceDateTime ?? "") > (current.occurrenceDateTime ?? "")) {
      mealByPatient.set(patientId, order);
    }
  }

  const rows = encounters.map((encounter): NutritionManagementRow => {
    const patientId = encounterPatientId(encounter) ?? "";
    const ward = bedWards.get(encounterBedId(encounter) ?? "");
    const cells = admissionDocumentCells({
      encounter,
      compositions: [],
      responses,
      settings,
      dischargeSummaryDays: 0,
      today,
    });
    const screenings = encounterTemplateResponses(encounter, responses, settings.nutrition_screening_template, today);
    const plans = encounterTemplateResponses(encounter, responses, settings.admission_plan_template, today);
    const latest = screenings.find(isCompleted);
    const meal = mealByPatient.get(patientId);
    return {
      encounter,
      patientId,
      patient: patientsById.get(patientId),
      wardId: ward?.wardId ?? "",
      wardName: ward?.wardName ?? "",
      bedLabel: encounterBedLabel(encounter),
      screening: latest ? summarizeNutritionScreening(latest) : null,
      screeningCell: cells["nutrition-screening"],
      need: nutritionNeedOf([...plans, ...screenings]),
      planCell: cells["nutrition-plan"],
      meal: meal ? mealOrderOneLine(meal) : "",
    };
  });
  return rows.sort(
    (a, b) =>
      a.wardName.localeCompare(b.wardName, "ja") || a.bedLabel.localeCompare(b.bedLabel, "ja", { numeric: true }),
  );
}

/** 一覧の絞り込み。need = 特別な栄養管理が有、malnutrition = GLIM で低栄養、pending = スクリーニングか計画書が済んでいない・期限超過。 */
export type NutritionManagementFilter = "" | "need" | "malnutrition" | "pending";

export function matchesNutritionFilter(row: NutritionManagementRow, filter: NutritionManagementFilter): boolean {
  switch (filter) {
    case "need":
      return row.need === "yes";
    case "malnutrition":
      return row.screening?.glim === GLIM_MALNUTRITION;
    case "pending":
      return [row.screeningCell, row.planCell].some(
        (cell) => cell.state === "missing" || cell.state === "draft" || cell.overdue,
      );
    default:
      return true;
  }
}

/** 一覧の上に出す数。割合の分母は、スクリーニング済み・低栄養・必要性は在院数、計画書は必要性が有の数。 */
export interface NutritionIndicators {
  inpatients: number;
  screened: number;
  malnourished: number;
  needed: number;
  planned: number;
}

export function nutritionIndicators(rows: NutritionManagementRow[]): NutritionIndicators {
  const needed = rows.filter((row) => row.need === "yes");
  return {
    inpatients: rows.length,
    screened: rows.filter((row) => row.screeningCell.state === "done").length,
    malnourished: rows.filter((row) => row.screening?.glim === GLIM_MALNUTRITION).length,
    needed: needed.length,
    planned: needed.filter((row) => row.planCell.state === "done").length,
  };
}
