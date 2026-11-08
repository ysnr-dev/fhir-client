import { useQuery } from "@tanstack/react-query";
import { DISCHARGE_SUMMARY_TYPE_SEARCH, NURSING_SUMMARY_TYPE_SEARCH } from "../../fhir/clinicalNoteHelpers";
import { excludeNursingProblems } from "../../fhir/conditionHelpers";
import { DPC_FORM1_QUESTIONNAIRE } from "../../fhir/dpcForm1Helpers";
import { ADMISSION_CLASS_CODE } from "../../fhir/encounterHelpers";
import { ENCOUNTER_HISTORY_EXCLUDED_STATUSES } from "../../fhir/encounterHistoryHelpers";
import { EXAM_REPORT_KINDS, examReportCategorySearch } from "../../fhir/examReportHelpers";
import { DRAFT_REPORT_STATUS, REPORT_CATEGORY_SYSTEM } from "../../fhir/pathoResultHelpers";
import { resourcesOfType } from "../../fhir/shared";
import { searchAllPages, setOrderPeriod } from "./core";
import { nursingOrderParams, nursingOrderSetOf } from "./nursing";
import { fetchNursingCarePlans } from "./nursingCarePlan";

// ---- 診療記録の一括出力(カルテ印刷の区画) ----
//
// 表紙・病名・退院時サマリーの読み込み(docs/record-export-design.md §4)。
// 画面に並べるだけなので、上限で欠けたら truncated を返して区画ごとに知らせる。

const ENCOUNTER_PAGE = 200;
const ENCOUNTER_MAX_PAGES = 5;
const CONDITION_PAGE = 200;
const CONDITION_MAX_PAGES = 5;
const SUMMARY_PAGE = 50;
const SUMMARY_MAX_PAGES = 4;
// encounter のカンマ OR に並べる id の 1 回ぶん(URL の長さを抑える)。
const ENCOUNTER_ID_CHUNK = 50;

/** 期間に重なる受診(古い順)。上流の Encounter の date は period の重なりで当たる。 */
export function useRecordExportEncounters(patientId: string | undefined, from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ["Encounter", "record-export", patientId, from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("subject", `Patient/${patientId}`);
      params.append("date", `ge${from}`);
      params.append("date", `le${to}`);
      params.set("status:not", ENCOUNTER_HISTORY_EXCLUDED_STATUSES.join(","));
      params.set("_sort", "date");
      params.set("_include", "Encounter:appointment");
      const { matches, bundles, truncated } = await searchAllPages<fhir4.Encounter>("Encounter", params, {
        page: ENCOUNTER_PAGE,
        maxPages: ENCOUNTER_MAX_PAGES,
      });
      const appointments = bundles.flatMap((bundle) => resourcesOfType<fhir4.Appointment>(bundle, "Appointment"));
      return { encounters: matches, appointments, truncated };
    },
    enabled: Boolean(patientId && from && to && enabled),
  });
}

/** 患者の病名すべて(開始日の古い順)。累積で出すので期間では切らない。 */
export function useRecordExportConditions(patientId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["Condition", "record-export", patientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("_sort", "onset-date");
      excludeNursingProblems(params);
      const { matches, truncated } = await searchAllPages<fhir4.Condition>("Condition", params, {
        page: CONDITION_PAGE,
        maxPages: CONDITION_MAX_PAGES,
      });
      return { conditions: matches, truncated };
    },
    enabled: Boolean(patientId && enabled),
  });
}

function admissionIdsOf(encounters: fhir4.Encounter[] | undefined): string[] {
  return (encounters ?? [])
    .filter((encounter) => encounter.class?.code === ADMISSION_CLASS_CODE)
    .flatMap((encounter) => (encounter.id ? [encounter.id] : []));
}

/** 入院の id をカンマ OR に並べて検索する(入院ごとに検索を並べない)。 */
async function searchByAdmissions<T extends fhir4.Resource>(
  type: T["resourceType"],
  ids: string[],
  base: URLSearchParams,
): Promise<{ matches: T[]; bundles: fhir4.Bundle[]; truncated: boolean }> {
  const matches: T[] = [];
  const bundles: fhir4.Bundle[] = [];
  let truncated = false;
  for (let index = 0; index < ids.length; index += ENCOUNTER_ID_CHUNK) {
    const params = new URLSearchParams(base);
    params.set(
      "encounter",
      ids
        .slice(index, index + ENCOUNTER_ID_CHUNK)
        .map((id) => `Encounter/${id}`)
        .join(","),
    );
    const result = await searchAllPages<T>(type, params, { page: SUMMARY_PAGE, maxPages: SUMMARY_MAX_PAGES });
    matches.push(...result.matches);
    bundles.push(...result.bundles);
    truncated ||= result.truncated;
  }
  return { matches, bundles, truncated };
}

// id を分けて読んだときも記録日の順にそろえる。
function byDate(a: fhir4.Composition, b: fhir4.Composition): number {
  return (a.date ?? "").localeCompare(b.date ?? "");
}

/** 確定した文書(Composition)を入院で引く。下書き(preliminary)は記録になる前のものなので出さない。 */
async function fetchAdmissionCompositions(ids: string[], type: string) {
  const params = new URLSearchParams();
  params.set("type", type);
  params.set("status", "final,amended");
  params.set("_sort", "date");
  const { matches, truncated } = await searchByAdmissions<fhir4.Composition>("Composition", ids, params);
  return { compositions: matches.sort(byDate), truncated };
}

/** 入院(期間に重なるもの)の退院時サマリー。 */
export function useRecordExportSummaries(admissions: fhir4.Encounter[] | undefined, enabled: boolean) {
  const ids = admissionIdsOf(admissions);
  return useQuery({
    queryKey: ["Composition", "search", "record-export-summaries", ids],
    queryFn: async () => {
      const { compositions, truncated } = await fetchAdmissionCompositions(ids, DISCHARGE_SUMMARY_TYPE_SEARCH);
      return { summaries: compositions, truncated };
    },
    enabled: Boolean(admissions && enabled),
  });
}

/**
 * 看護の区画: 期間に掛かる看護問題(計画・評価)と、期間に重なる入院の看護サマリー・看護プロファイル。
 * 看護問題は患者ぶんを看護計画タブと同じ組み立てで読み、立案日・解決日で期間に掛かるものを残す
 * (上流の 1 回の検索では「解決していない、または期間の後に解決した」を表せない)。
 */
export function useRecordExportNursing(
  patientId: string | undefined,
  admissions: fhir4.Encounter[] | undefined,
  from: string,
  to: string,
  enabled: boolean,
) {
  const ids = admissionIdsOf(admissions);
  return useQuery({
    queryKey: ["record-export", "nursing", patientId, ids, from, to],
    queryFn: async () => {
      const profileParams = new URLSearchParams();
      profileParams.set("questionnaire:not", DPC_FORM1_QUESTIONNAIRE);
      profileParams.set("_include", "QuestionnaireResponse:questionnaire");
      const [plans, summaries, profiles] = await Promise.all([
        fetchNursingCarePlans(patientId as string),
        fetchAdmissionCompositions(ids, NURSING_SUMMARY_TYPE_SEARCH),
        searchByAdmissions<fhir4.QuestionnaireResponse>("QuestionnaireResponse", ids, profileParams),
      ]);
      return {
        problems: plans.items.filter(
          (view) => view.onsetDate <= to && (!view.abatementDate || view.abatementDate >= from),
        ),
        summaries: summaries.compositions,
        profileResponses: profiles.matches,
        profileQuestionnaires: profiles.bundles.flatMap((bundle) =>
          resourcesOfType<fhir4.Questionnaire>(bundle, "Questionnaire"),
        ),
        truncated: plans.truncated || summaries.truncated || profiles.truncated,
      };
    },
    enabled: Boolean(patientId && admissions && enabled),
  });
}

/** 期間に掛かる看護指示(中止・終了を含む。指示の取消と下書きは除く)。開始日の古い順。 */
export function useRecordExportNursingOrders(patientId: string | undefined, from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "record-export-nursing", patientId, from, to],
    queryFn: async () => {
      const params = nursingOrderParams(patientId);
      params.delete("_revinclude");
      params.delete("_count");
      params.set("status:not", "entered-in-error,draft");
      params.set("_sort", "authoredon");
      setOrderPeriod(params, from, to);
      const { bundles, truncated } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
        page: 500,
        maxPages: 4,
      });
      const { orders } = nursingOrderSetOf({
        resourceType: "Bundle",
        type: "searchset",
        entry: bundles.flatMap((bundle) => bundle.entry ?? []),
      });
      return { orders, truncated };
    },
    enabled: Boolean(patientId && from && to && enabled),
  });
}

const DIAGNOSTIC_REPORT_PAGE = 200;
const DIAGNOSTIC_REPORT_MAX_PAGES = 5;

async function searchReports(patientId: string, category: string, from: string, to: string) {
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  params.set("category", category);
  params.append("date", `ge${from}`);
  params.append("date", `le${to}`);
  params.set("status:not", `${DRAFT_REPORT_STATUS},entered-in-error`);
  params.set("_sort", "date");
  params.append("_include", "DiagnosticReport:result");
  params.append("_include", "DiagnosticReport:specimen");
  const { matches, bundles, truncated } = await searchAllPages<fhir4.DiagnosticReport>("DiagnosticReport", params, {
    page: DIAGNOSTIC_REPORT_PAGE,
    maxPages: DIAGNOSTIC_REPORT_MAX_PAGES,
  });
  return {
    reports: matches,
    observations: bundles.flatMap((bundle) => resourcesOfType<fhir4.Observation>(bundle, "Observation")),
    specimens: bundles.flatMap((bundle) => resourcesOfType<fhir4.Specimen>(bundle, "Specimen")),
    truncated,
  };
}

/** 期間内の検体検査結果(採取日の古い順)。検歴の累積表にする。 */
export function useRecordExportLabs(patientId: string | undefined, from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ["DiagnosticReport", "search", "record-export-labs", patientId, from, to],
    queryFn: () => searchReports(patientId as string, "LAB", from, to),
    enabled: Boolean(patientId && from && to && enabled),
  });
}

/** 期間内の所見レポート(放射線・生理・内視鏡)と病理レポート。検査日の古い順。 */
export function useRecordExportReports(patientId: string | undefined, from: string, to: string, enabled: boolean) {
  const category = [
    ...EXAM_REPORT_KINDS.map(examReportCategorySearch),
    `${REPORT_CATEGORY_SYSTEM}|SP`,
    `${REPORT_CATEGORY_SYSTEM}|CP`,
  ].join(",");
  return useQuery({
    queryKey: ["DiagnosticReport", "search", "record-export-reports", patientId, from, to],
    queryFn: () => searchReports(patientId as string, category, from, to),
    enabled: Boolean(patientId && from && to && enabled),
  });
}
