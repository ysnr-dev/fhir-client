import { addDays } from "../lib/dates";
import { DISCHARGE_SUMMARY_TYPE_SEARCH, isNursingSummary } from "./clinicalNoteHelpers";
import { responseAnswer } from "./conditionTemplateHelpers";
import { DISCHARGED_STATUS } from "./encounterHelpers";
import {
  NURSING_SUMMARY_STATE_LABELS,
  nursingSummaryKindOf,
  nursingSummaryStateOf,
} from "./nursingSummaryHelpers";
import { referenceId } from "./shared";

// 入退院文書の作成状況(docs/bed-management-design.md §4)。入院 1 件ごとに、入院診療計画書・
// 退院時サマリー・看護サマリー(退院)が作られているかと期限を出す。
//
// - 入院診療計画書: 施設設定のテンプレートへの回答。入院日から N 日以内(既定 7 日。入院基本料の
//   要件の「入院後 7 日以内に説明」)。回答が入院を持てばそれで、持たなければ入院期間の日付で当てる
// - 退院時サマリー: type 18842-5 の Composition(encounter で入院に紐付く)。退院日から N 日以内
//   (文書作成の督促と同じ日数)
// - 看護サマリー: 区分「退院」の看護サマリー。退院日から N 日以内
// - 栄養スクリーニング: 施設設定のテンプレートへの回答。入院日から N 日以内(既定 3 日)
// - 栄養管理計画書: 施設設定のテンプレートへの回答。スクリーニングか入院診療計画書の「特別な栄養管理の
//   必要性」(linkId nutrition_need、01 = 有)が有の入院だけが対象で、入院日から N 日以内(既定 7 日)。
//   作成済でも、最新の計画書の再評価日(linkId reassess_date)を過ぎて在院していれば期限超過にする
// - 褥瘡リスク評価: 施設設定のテンプレート(看護プロファイルの区画「褥瘡リスク」など)への回答。入院日から N 日以内(既定 1 日)
// - 褥瘡対策計画書: 施設設定のテンプレートへの回答。最新の褥瘡リスク評価で計画が要る入院だけが対象で、入院日から
//   N 日以内(既定 7 日)。再評価日の扱いは栄養管理計画書と同じ
// 退院系の文書は退院するまで期限が決まらない(作り始めていれば状態だけ出す)。

/** 施設設定 admission_documents(backend の DEFAULT_ADMISSION_DOCUMENTS と同じ形)。 */
export interface AdmissionDocumentSettings {
  /** 入院診療計画書のテンプレートの url(版を問わない)。空なら対象にしない。 */
  admission_plan_template: string;
  admission_plan_days: number;
  nursing_summary_days: number;
  /** 栄養スクリーニングのテンプレートの url(版を問わない)。空なら対象にしない。 */
  nutrition_screening_template: string;
  nutrition_screening_days: number;
  /** 栄養管理計画書のテンプレートの url(版を問わない)。空なら対象にしない。 */
  nutrition_plan_template: string;
  nutrition_plan_days: number;
  /** 褥瘡リスク評価のテンプレートの url(版を問わない)。空なら対象にしない。 */
  pressure_ulcer_risk_template: string;
  pressure_ulcer_risk_days: number;
  /** 褥瘡対策に関する診療計画書のテンプレートの url(版を問わない)。空なら対象にしない。 */
  pressure_ulcer_plan_template: string;
  pressure_ulcer_plan_days: number;
}

export const DEFAULT_ADMISSION_DOCUMENTS: AdmissionDocumentSettings = {
  admission_plan_template: "",
  admission_plan_days: 7,
  nursing_summary_days: 7,
  nutrition_screening_template: "",
  nutrition_screening_days: 3,
  nutrition_plan_template: "",
  nutrition_plan_days: 7,
  pressure_ulcer_risk_template: "",
  pressure_ulcer_risk_days: 1,
  pressure_ulcer_plan_template: "",
  pressure_ulcer_plan_days: 7,
};

export type AdmissionDocumentKind =
  | "admission-plan"
  | "nutrition-screening"
  | "nutrition-plan"
  | "pressure-ulcer-risk"
  | "pressure-ulcer-plan"
  | "discharge-summary"
  | "nursing-summary";

export const ADMISSION_DOCUMENT_KINDS: { kind: AdmissionDocumentKind; label: string }[] = [
  { kind: "admission-plan", label: "入院診療計画書" },
  { kind: "nutrition-screening", label: "栄養スクリーニング" },
  { kind: "nutrition-plan", label: "栄養管理計画書" },
  { kind: "pressure-ulcer-risk", label: "褥瘡リスク評価" },
  { kind: "pressure-ulcer-plan", label: "褥瘡対策計画書" },
  { kind: "discharge-summary", label: "退院時サマリー" },
  { kind: "nursing-summary", label: "看護サマリー" },
];

/** 種別のテンプレート(テンプレートの回答で数える種別だけ)。空なら列を出さない。 */
export function admissionDocumentTemplate(
  kind: AdmissionDocumentKind,
  settings: AdmissionDocumentSettings,
): string | undefined {
  switch (kind) {
    case "admission-plan":
      return settings.admission_plan_template;
    case "nutrition-screening":
      return settings.nutrition_screening_template;
    case "nutrition-plan":
      return settings.nutrition_plan_template;
    case "pressure-ulcer-risk":
      return settings.pressure_ulcer_risk_template;
    case "pressure-ulcer-plan":
      return settings.pressure_ulcer_plan_template;
    default:
      return undefined;
  }
}

/** 栄養管理の必要性の回答(入院診療計画書・栄養スクリーニングで共通の linkId とコード)。 */
export const NUTRITION_NEED_LINK_ID = "nutrition_need";
const NUTRITION_NEED_YES = "01";
const NUTRITION_NEED_NO = "02";
/** 計画書(栄養管理計画書・褥瘡対策計画書)の再評価日。 */
export const REASSESS_LINK_ID = "reassess_date";

/** 褥瘡リスク評価の回答(看護プロファイルの「褥瘡リスク」と褥瘡対策計画書で共通の linkId。「あり・できない」が 1)。 */
export const PRESSURE_ULCER_ADL_LINK_ID = "pu_bedridden_level";
export const PRESSURE_ULCER_PRESENT_LINK_ID = "pu_present";
export const PRESSURE_ULCER_RISK_LINK_PREFIX = "pu_risk_";

/**
 * 褥瘡対策の計画が要るか。現に褥瘡があれば要る。日常生活自立度が J・A なら要らない。それ以外(B・C か未回答)は
 * 危険因子(あり・できない)が 1 つでもあれば要る。危険因子も褥瘡の有無も答えていなければ判定できない。
 */
export function pressureUlcerPlanNeed(response: fhir4.QuestionnaireResponse | undefined): "yes" | "no" | "unknown" {
  if (!response) return "unknown";
  const codes = new Map<string, string>();
  const walk = (items: fhir4.QuestionnaireResponseItem[] | undefined) => {
    for (const item of items ?? []) {
      const code = item.answer?.[0]?.valueCoding?.code;
      if (code !== undefined) codes.set(item.linkId, code);
      walk(item.item);
      for (const answer of item.answer ?? []) walk(answer.item);
    }
  };
  walk(response.item);
  if (codes.get(PRESSURE_ULCER_PRESENT_LINK_ID) === "1") return "yes";
  const adl = codes.get(PRESSURE_ULCER_ADL_LINK_ID) ?? "";
  if (/^[JA]/.test(adl)) return "no";
  const risks = [...codes].filter(([linkId]) => linkId.startsWith(PRESSURE_ULCER_RISK_LINK_PREFIX));
  if (risks.some(([, code]) => code === "1")) return "yes";
  return risks.length > 0 || codes.has(PRESSURE_ULCER_PRESENT_LINK_ID) ? "no" : "unknown";
}

/**
 * 文書 1 つの状況。done = 作成済(確定・承認待ち・承認済)、draft = 作成中、missing = 未作成、
 * pending = まだ作らなくてよい(退院前の退院系の文書・必要性の判定前の計画書)、
 * not-required = 作らなくてよいと決まった(栄養管理・褥瘡対策の必要性が無の計画書)。
 */
export interface AdmissionDocumentCell {
  state: "done" | "draft" | "missing" | "pending" | "not-required";
  /** 「確定」「作成中」「承認待ち」「判定前」など。未作成・退院前は空。 */
  label: string;
  /** 期限(含む)。退院前の退院系の文書は空。 */
  due: string;
  /** 期限を過ぎても作成済になっていない。 */
  overdue: boolean;
  /** 作成中・作成済の文書の id(カルテで開くため)。 */
  resourceId: string;
}

function dateOf(value: string | undefined): string {
  return value?.slice(0, 10) ?? "";
}

function cell(
  state: AdmissionDocumentCell["state"],
  label: string,
  due: string,
  today: string,
  resourceId = "",
): AdmissionDocumentCell {
  const open = state === "draft" || state === "missing";
  return { state, label, due, overdue: open && Boolean(due) && today > due, resourceId };
}

function isTemplateResponse(response: fhir4.QuestionnaireResponse, url: string): boolean {
  return (response.questionnaire ?? "").split("|")[0] === url;
}

function isCompleted(response: fhir4.QuestionnaireResponse): boolean {
  return response.status === "completed" || response.status === "amended";
}

/** 新しい順(記入日時の降順)。 */
function byAuthoredDesc(a: fhir4.QuestionnaireResponse, b: fhir4.QuestionnaireResponse): number {
  return (b.authored ?? "").localeCompare(a.authored ?? "");
}

/** テンプレートの回答がどの入院のものか。入院を持てばそれ、持たなければ日付が入院期間(入院日の 7 日前から)に入るもの。 */
function responseBelongsTo(response: fhir4.QuestionnaireResponse, encounter: fhir4.Encounter, today: string): boolean {
  const encounterId = referenceId(response.encounter?.reference);
  if (encounterId) return encounterId === encounter.id;
  const authored = dateOf(response.authored);
  const admission = dateOf(encounter.period?.start);
  const discharge = encounter.status === DISCHARGED_STATUS ? dateOf(encounter.period?.end) : today;
  return Boolean(authored && admission) && authored >= addDays(admission, -7) && authored <= discharge;
}

function isDischargeSummary(composition: fhir4.Composition): boolean {
  const [system, code] = DISCHARGE_SUMMARY_TYPE_SEARCH.split("|");
  return Boolean(composition.type?.coding?.some((c) => c.system === system && c.code === code));
}

/** 入院 1 件の文書の状況。 */
export function admissionDocumentCells(args: {
  encounter: fhir4.Encounter;
  compositions: fhir4.Composition[];
  responses: fhir4.QuestionnaireResponse[];
  settings: AdmissionDocumentSettings;
  dischargeSummaryDays: number;
  today: string;
}): Record<AdmissionDocumentKind, AdmissionDocumentCell> {
  const { encounter, compositions, responses, settings, dischargeSummaryDays, today } = args;
  const admission = dateOf(encounter.period?.start);
  const discharged = encounter.status === DISCHARGED_STATUS;
  const discharge = discharged ? dateOf(encounter.period?.end) : "";
  const own = compositions.filter((c) => referenceId(c.encounter?.reference) === encounter.id);

  // テンプレートの回答(この入院のもの、誤記・中止を除く)を新しい順に。
  const patientId = referenceId(encounter.subject?.reference);
  const ownResponses = responses
    .filter(
      (r) =>
        referenceId(r.subject?.reference) === patientId &&
        r.status !== "entered-in-error" &&
        r.status !== "stopped" &&
        responseBelongsTo(r, encounter, today),
    )
    .sort(byAuthoredDesc);
  const responsesOf = (url: string) => (url ? ownResponses.filter((r) => isTemplateResponse(r, url)) : []);

  // 確定(completed / amended)を優先し、無ければ書きかけ。
  const templateCell = (list: fhir4.QuestionnaireResponse[], due: string): AdmissionDocumentCell => {
    const completed = list.find(isCompleted);
    const draft = list.find((r) => r.status === "in-progress");
    return completed
      ? cell("done", "作成済", due, today, completed.id)
      : draft
        ? cell("draft", "作成中", due, today, draft.id)
        : cell("missing", "", due, today);
  };

  // 必要性で対象が決まる計画書。必要性が有のときだけ未作成、無なら不要、未定なら判定前。作成済でも、最新の
  // 確定した計画書の再評価日を過ぎて在院していれば書き直し(再評価)を促す。
  const planCell = (
    list: fhir4.QuestionnaireResponse[],
    due: string,
    need: "yes" | "no" | "unknown",
  ): AdmissionDocumentCell => {
    const result = templateCell(list, due);
    if (result.state === "done") {
      const reassess = responseAnswer(list.find(isCompleted), REASSESS_LINK_ID)?.valueDate ?? "";
      return reassess && !discharged && today > reassess
        ? { ...result, label: "再評価", due: reassess, overdue: true }
        : result;
    }
    if (result.state === "missing" && need !== "yes") {
      return need === "no" ? cell("not-required", "不要", "", today) : cell("pending", "判定前", "", today);
    }
    return result;
  };

  const plans = responsesOf(settings.admission_plan_template);
  const admissionPlan = templateCell(
    plans,
    admission ? addDays(admission, settings.admission_plan_days) : "",
  );

  const screenings = responsesOf(settings.nutrition_screening_template);
  const screeningCell = templateCell(
    screenings,
    admission ? addDays(admission, settings.nutrition_screening_days) : "",
  );

  // 栄養管理計画書。必要性は確定した入院診療計画書・スクリーニングのどれかが有なら有、
  // 無と答えたものがあって有が無ければ無。どちらも答えていなければ判定前。
  const needs = [...plans, ...screenings]
    .filter(isCompleted)
    .map((r) => responseAnswer(r, NUTRITION_NEED_LINK_ID)?.valueCoding?.code);
  const nutritionNeed: "yes" | "no" | "unknown" = needs.includes(NUTRITION_NEED_YES)
    ? "yes"
    : needs.includes(NUTRITION_NEED_NO)
      ? "no"
      : "unknown";
  const nutritionPlanCell = planCell(
    responsesOf(settings.nutrition_plan_template),
    admission ? addDays(admission, settings.nutrition_plan_days) : "",
    nutritionNeed,
  );

  // 褥瘡対策計画書。必要性は確定した最新の褥瘡リスク評価で決める(評価し直したら新しいほうに従う)。
  const risks = responsesOf(settings.pressure_ulcer_risk_template);
  const riskCell = templateCell(
    risks,
    admission ? addDays(admission, settings.pressure_ulcer_risk_days) : "",
  );
  const pressureUlcerPlanCell = planCell(
    responsesOf(settings.pressure_ulcer_plan_template),
    admission ? addDays(admission, settings.pressure_ulcer_plan_days) : "",
    pressureUlcerPlanNeed(risks.find(isCompleted)),
  );

  // 退院時サマリー。
  const summaryDue = discharge ? addDays(discharge, dischargeSummaryDays) : "";
  const summary = own.find(isDischargeSummary);
  const summaryCell = summary
    ? summary.status === "preliminary"
      ? cell("draft", "作成中", summaryDue, today, summary.id)
      : cell("done", "確定", summaryDue, today, summary.id)
    : cell(discharged ? "missing" : "pending", "", summaryDue, today);

  // 看護サマリー(退院)。承認待ちも作成済に数える(書く側の仕事は終わっている)。
  const nursingDue = discharge ? addDays(discharge, settings.nursing_summary_days) : "";
  const nursing = own.find((c) => isNursingSummary(c) && nursingSummaryKindOf(c) === "discharge");
  let nursingCell: AdmissionDocumentCell;
  if (nursing) {
    const state = nursingSummaryStateOf(nursing, false);
    nursingCell = cell(
      state === "draft" ? "draft" : "done",
      NURSING_SUMMARY_STATE_LABELS[state],
      nursingDue,
      today,
      nursing.id,
    );
  } else {
    nursingCell = cell(discharged ? "missing" : "pending", "", nursingDue, today);
  }

  return {
    "admission-plan": admissionPlan,
    "nutrition-screening": screeningCell,
    "nutrition-plan": nutritionPlanCell,
    "pressure-ulcer-risk": riskCell,
    "pressure-ulcer-plan": pressureUlcerPlanCell,
    "discharge-summary": summaryCell,
    "nursing-summary": nursingCell,
  };
}
