import { addDays } from "../lib/dates";
import { DISCHARGE_SUMMARY_TYPE_SEARCH, isNursingSummary } from "./clinicalNoteHelpers";
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
// 退院系の文書は退院するまで期限が決まらない(作り始めていれば状態だけ出す)。

/** 施設設定 admission_documents(backend の DEFAULT_ADMISSION_DOCUMENTS と同じ形)。 */
export interface AdmissionDocumentSettings {
  /** 入院診療計画書のテンプレートの url(版を問わない)。空なら対象にしない。 */
  admission_plan_template: string;
  admission_plan_days: number;
  nursing_summary_days: number;
}

export const DEFAULT_ADMISSION_DOCUMENTS: AdmissionDocumentSettings = {
  admission_plan_template: "",
  admission_plan_days: 7,
  nursing_summary_days: 7,
};

export type AdmissionDocumentKind = "admission-plan" | "discharge-summary" | "nursing-summary";

export const ADMISSION_DOCUMENT_KINDS: { kind: AdmissionDocumentKind; label: string }[] = [
  { kind: "admission-plan", label: "入院診療計画書" },
  { kind: "discharge-summary", label: "退院時サマリー" },
  { kind: "nursing-summary", label: "看護サマリー" },
];

/**
 * 文書 1 つの状況。done = 作成済(確定・承認待ち・承認済)、draft = 作成中、missing = 未作成、
 * pending = 退院前で期限が決まっていない(まだ作らなくてよい)。
 */
export interface AdmissionDocumentCell {
  state: "done" | "draft" | "missing" | "pending";
  /** 「確定」「作成中」「承認待ち」など。未作成・退院前は空。 */
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
  return { state, label, due, overdue: state !== "done" && Boolean(due) && today > due, resourceId };
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

  // 入院診療計画書。確定(completed / amended)を優先し、無ければ書きかけ。
  const planDue = admission ? addDays(admission, settings.admission_plan_days) : "";
  const patientId = referenceId(encounter.subject?.reference);
  const plans = responses.filter(
    (r) =>
      referenceId(r.subject?.reference) === patientId &&
      r.status !== "entered-in-error" &&
      r.status !== "stopped" &&
      responseBelongsTo(r, encounter, today),
  );
  const completedPlan = plans.find((r) => r.status === "completed" || r.status === "amended");
  const draftPlan = plans.find((r) => r.status === "in-progress");
  const admissionPlan = completedPlan
    ? cell("done", "作成済", planDue, today, completedPlan.id)
    : draftPlan
      ? cell("draft", "作成中", planDue, today, draftPlan.id)
      : cell("missing", "", planDue, today);

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
    "discharge-summary": summaryCell,
    "nursing-summary": nursingCell,
  };
}
