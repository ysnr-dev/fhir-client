import { useQuery } from "@tanstack/react-query";
import { DISCHARGE_SUMMARY_TYPE_SEARCH } from "../../fhir/clinicalNoteHelpers";
import { excludeNursingProblems } from "../../fhir/conditionHelpers";
import { ADMISSION_CLASS_CODE } from "../../fhir/encounterHelpers";
import { ENCOUNTER_HISTORY_EXCLUDED_STATUSES } from "../../fhir/encounterHistoryHelpers";
import { resourcesOfType } from "../../fhir/shared";
import { searchAllPages } from "./core";

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

/** 入院(期間に重なるもの)の退院時サマリー。下書きは出さない。 */
export function useRecordExportSummaries(admissions: fhir4.Encounter[] | undefined, enabled: boolean) {
  const ids = (admissions ?? [])
    .filter((encounter) => encounter.class?.code === ADMISSION_CLASS_CODE)
    .flatMap((encounter) => (encounter.id ? [encounter.id] : []));
  return useQuery({
    queryKey: ["Composition", "search", "record-export-summaries", ids],
    queryFn: async () => {
      const summaries: fhir4.Composition[] = [];
      let truncated = false;
      for (let index = 0; index < ids.length; index += ENCOUNTER_ID_CHUNK) {
        const params = new URLSearchParams();
        params.set(
          "encounter",
          ids
            .slice(index, index + ENCOUNTER_ID_CHUNK)
            .map((id) => `Encounter/${id}`)
            .join(","),
        );
        params.set("type", DISCHARGE_SUMMARY_TYPE_SEARCH);
        params.set("status", "final,amended");
        params.set("_sort", "date");
        const result = await searchAllPages<fhir4.Composition>("Composition", params, {
          page: SUMMARY_PAGE,
          maxPages: SUMMARY_MAX_PAGES,
        });
        summaries.push(...result.matches);
        truncated ||= result.truncated;
      }
      // id を分けて読んだときも記録日の順にそろえる。
      summaries.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      return { summaries, truncated };
    },
    enabled: Boolean(admissions && enabled),
  });
}
