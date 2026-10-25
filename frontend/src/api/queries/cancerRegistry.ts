import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cancerRegistryIcd10Tokens } from "../../fhir/cancerRegistryHelpers";
import { excludeNursingProblems } from "../../fhir/conditionHelpers";
import { questionnaireCanonical } from "../../fhir/questionnaireResponseHelpers";
import { searchResource } from "../fhirClient";
import { searchAllPages } from "./core";
import { fetchMissingPatients, searchExtractRecords } from "./extractRecords";

// 院内がん登録の登録対象と登録(docs/cancer-registry-design.md §4)。
//
// 登録対象は ICD-10 が悪性新生物などに当たる病名(Condition)を開始日の期間で引く。上流の token 検索は完全一致なので
// 範囲を 4 桁まで広げたトークンを 100 件ずつ `code=` に並べる(データ抽出の病名と同じ手)。
// 登録はテンプレートの全版の canonical と候補の患者で回答を引く(褥瘡管理と同じ手)。

const CODE_CHUNK = 100;
const CONDITION_PAGING = { page: 500, maxPages: 4 };

export interface CancerRegistryCandidates {
  conditions: fhir4.Condition[];
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

/** 登録対象の病名(開始日が from〜to)。疑い・否定・誤記と看護問題は除く。 */
export function useCancerRegistryCandidates(from: string, to: string) {
  return useQuery({
    queryKey: ["Condition", "search", "cancer-registry", from, to],
    queryFn: async (): Promise<CancerRegistryCandidates> => {
      const signal = new AbortController().signal;
      const base = new URLSearchParams();
      base.set("verification-status:not", "entered-in-error,refuted,provisional");
      excludeNursingProblems(base);
      if (from) base.append("onset-date", `ge${from}`);
      if (to) base.append("onset-date", `le${to}`);
      base.set("_include", "Condition:subject");
      base.set("_sort", "-onset-date");

      const tokens = cancerRegistryIcd10Tokens();
      const conditions = new Map<string, fhir4.Condition>();
      const patients = new Map<string, fhir4.Patient>();
      let truncated = false;
      for (let i = 0; i < tokens.length; i += CODE_CHUNK) {
        const params = new URLSearchParams(base);
        params.set("code", tokens.slice(i, i + CODE_CHUNK).join(","));
        const page = await searchAllPages<fhir4.Condition>("Condition", params, { ...CONDITION_PAGING, strict: true, signal });
        for (const match of page.matches) if (match.id) conditions.set(match.id, match);
        truncated ||= page.truncated;
        for (const bundle of page.bundles) {
          for (const entry of bundle.entry ?? []) {
            const resource = entry.resource;
            if (resource?.resourceType === "Patient" && resource.id) patients.set(resource.id, resource as fhir4.Patient);
          }
        }
      }
      const list = [...conditions.values()];
      await fetchMissingPatients(
        list.map((c) => c.subject?.reference?.split("/").pop() ?? ""),
        patients,
        signal,
      );
      return { conditions: list, patients, truncated };
    },
    enabled: Boolean(from) && Boolean(to),
    placeholderData: keepPreviousData,
  });
}

export interface CancerRegistryResponses {
  questionnaires: fhir4.Questionnaire[];
  responses: fhir4.QuestionnaireResponse[];
  truncated: boolean;
}

/** テンプレート(全版)への回答のうち、候補の患者のもの。 */
export function useCancerRegistryResponses(templateUrl: string, patientIds: string[]) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["QuestionnaireResponse", "search", "cancer-registry", templateUrl, ids.join(",")],
    queryFn: async (): Promise<CancerRegistryResponses> => {
      const signal = new AbortController().signal;
      const versionParams = new URLSearchParams({ url: templateUrl, _count: "100" });
      const { data } = await searchResource<fhir4.Questionnaire>("Questionnaire", versionParams, { strict: true, signal });
      const questionnaires = (data.entry ?? [])
        .map((entry) => entry.resource)
        .filter((r): r is fhir4.Questionnaire => r?.resourceType === "Questionnaire");
      const canonicals = [...new Set(questionnaires.map(questionnaireCanonical))];
      if (canonicals.length === 0 || ids.length === 0) return { questionnaires, responses: [], truncated: false };
      const params = new URLSearchParams();
      params.set("questionnaire", canonicals.join(","));
      params.set("status", "in-progress,completed,amended");
      params.set("_sort", "-authored");
      const { matches, truncated } = await searchExtractRecords<fhir4.QuestionnaireResponse>(
        "QuestionnaireResponse",
        params,
        ids,
        signal,
      );
      return { questionnaires, responses: matches, truncated };
    },
    enabled: Boolean(templateUrl),
    placeholderData: keepPreviousData,
  });
}
