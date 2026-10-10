import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DISCHARGE_SUMMARY_TYPE_SEARCH, NURSING_SUMMARY_TYPE_SEARCH } from "../../fhir/clinicalNoteHelpers";
import { ADMISSION_CLASS_CODE, ADMISSION_STATUS, DISCHARGED_STATUS } from "../../fhir/encounterHelpers";
import { resourcesOfType, searchAllPages } from "./core";

// ---- ベッドスケジュール・病床状況・入退院文書の作成状況(docs/bed-management-design.md) ----

export interface EncountersInRange {
  /** 期間に一日でも在院した入院(入院中・退院済)。 */
  encounters: fhir4.Encounter[];
  patientsById: Map<string, fhir4.Patient>;
  truncated: boolean;
}

/**
 * 期間 [from, to] に一日でも在院した入院。入院患者一覧(fetchInpatients)の 1 日を期間に広げたもので、
 * 期間との重なりは date の ge と le の AND で表す(date=ge<from> → 退院していないか from 以降に退院、
 * date=le<to> → to までに入院)。
 */
export function useEncountersInRange(from: string, to: string) {
  return useQuery({
    queryKey: ["Encounter", "range", from, to],
    queryFn: async (): Promise<EncountersInRange> => {
      const params = new URLSearchParams();
      params.set("status", `${ADMISSION_STATUS},${DISCHARGED_STATUS}`);
      params.set("class", ADMISSION_CLASS_CODE);
      params.append("date", `ge${from}`);
      params.append("date", `le${to}`);
      params.set("_include", "Encounter:subject");
      const { matches, bundles, truncated } = await searchAllPages<fhir4.Encounter>("Encounter", params, {
        page: 500,
        maxPages: 4,
      });
      const patientsById = new Map<string, fhir4.Patient>();
      for (const bundle of bundles) {
        for (const patient of resourcesOfType<fhir4.Patient>(bundle, "Patient")) {
          if (patient.id) patientsById.set(patient.id, patient);
        }
      }
      return { encounters: matches, patientsById, truncated };
    },
    enabled: Boolean(from) && Boolean(to),
    placeholderData: keepPreviousData,
  });
}

/** テンプレートの url に対する canonical(版を省いたものと、登録されている版ごとのもの)。 */
async function templateCanonicals(url: string): Promise<string[]> {
  const params = new URLSearchParams();
  params.set("url", url);
  params.set("_elements", "url,version");
  const { matches } = await searchAllPages<fhir4.Questionnaire>("Questionnaire", params, { page: 100, maxPages: 1 });
  const versioned = matches.filter((q) => q.version).map((q) => `${url}|${q.version}`);
  return [url, ...new Set(versioned)];
}

// 1 回の検索に載せる入院・患者の数(URL が長くなりすぎないように分ける)。
const DOCUMENT_CHUNK = 40;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export interface AdmissionDocumentResources {
  /** 退院時サマリー・看護サマリー(encounter を持つ Composition)。 */
  compositions: fhir4.Composition[];
  /** 入院診療計画書のテンプレートへの回答。 */
  responses: fhir4.QuestionnaireResponse[];
  truncated: boolean;
}

/**
 * 入院ごとの文書。退院時サマリー・看護サマリーは入院(encounter)で、入院診療計画書は患者と
 * テンプレートで引く(テンプレートの回答は入院を持たないことがあるので、画面側で日付で入院に当てる)。
 */
export function useAdmissionDocumentResources(
  encounterIds: string[],
  patientIds: string[],
  admissionPlanTemplate: string,
) {
  const encounters = [...new Set(encounterIds)].sort();
  const patients = [...new Set(patientIds)].sort();
  return useQuery({
    queryKey: ["Composition", "admission-documents", encounters.join(","), patients.join(","), admissionPlanTemplate],
    queryFn: async (): Promise<AdmissionDocumentResources> => {
      const paging = { page: 500, maxPages: 4 };
      const compositionSearches = chunks(encounters, DOCUMENT_CHUNK).map((chunk) => {
        const params = new URLSearchParams();
        params.set("type", `${DISCHARGE_SUMMARY_TYPE_SEARCH},${NURSING_SUMMARY_TYPE_SEARCH}`);
        params.set("encounter", chunk.map((id) => `Encounter/${id}`).join(","));
        params.set("_elements", "id,status,type,category,encounter,attester,date,subject");
        return searchAllPages<fhir4.Composition>("Composition", params, paging);
      });
      // 回答は版付きの canonical を持ち、上流の questionnaire 検索は版を省いた url で版付きに当たらない
      // (server-improvement-backlog.md)。テンプレートの版を引いて、版ごとの canonical を並べて引く。
      const canonicals = admissionPlanTemplate ? await templateCanonicals(admissionPlanTemplate) : [];
      const responseSearches = admissionPlanTemplate
        ? chunks(patients, DOCUMENT_CHUNK).map((chunk) => {
            const params = new URLSearchParams();
            params.set("questionnaire", canonicals.join(","));
            params.set("patient", chunk.map((id) => `Patient/${id}`).join(","));
            params.set("_elements", "id,status,questionnaire,subject,encounter,authored");
            return searchAllPages<fhir4.QuestionnaireResponse>("QuestionnaireResponse", params, paging);
          })
        : [];
      const [compositions, responses] = await Promise.all([
        Promise.all(compositionSearches),
        Promise.all(responseSearches),
      ]);
      return {
        compositions: compositions.flatMap((result) => result.matches),
        responses: responses.flatMap((result) => result.matches),
        truncated: [...compositions, ...responses].some((result) => result.truncated),
      };
    },
    enabled: encounters.length > 0,
    placeholderData: keepPreviousData,
  });
}
