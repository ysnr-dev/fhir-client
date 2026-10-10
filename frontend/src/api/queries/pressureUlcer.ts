import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { questionnaireCanonical } from "../../fhir/questionnaireResponseHelpers";
import { searchResource } from "../fhirClient";
import { searchExtractRecords } from "./extractRecords";

// ---- 褥瘡の DESIGN-R 評価の回答(docs/care-team-design.md §6) ----
//
// テンプレートの url から全版の canonical を引き(上流の questionnaire 検索は版込みの完全一致)、
// 患者を subject= に 100 人ずつ並べて回答を読む(テンプレートの抽出と同じ手)。

async function fetchVersions(url: string, signal: AbortSignal): Promise<fhir4.Questionnaire[]> {
  const params = new URLSearchParams({ url, _count: "100" });
  const { data } = await searchResource<fhir4.Questionnaire>("Questionnaire", params, { strict: true, signal });
  return (data.entry ?? [])
    .map((entry) => entry.resource)
    .filter((r): r is fhir4.Questionnaire => r?.resourceType === "Questionnaire");
}

export interface PressureUlcerResponses {
  questionnaires: fhir4.Questionnaire[];
  responses: fhir4.QuestionnaireResponse[];
  truncated: boolean;
}

/** 患者(複数)の DESIGN-R 評価の回答。to を渡すとその日までに記入したもの。 */
export function usePressureUlcerResponses(templateUrl: string, patientIds: string[], to?: string) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["QuestionnaireResponse", "search", "pressure-ulcer", templateUrl, ids.join(","), to ?? ""],
    queryFn: async (): Promise<PressureUlcerResponses> => {
      const signal = new AbortController().signal;
      const questionnaires = await fetchVersions(templateUrl, signal);
      const canonicals = [...new Set(questionnaires.map(questionnaireCanonical))];
      if (canonicals.length === 0 || ids.length === 0) return { questionnaires, responses: [], truncated: false };
      const params = new URLSearchParams();
      params.set("questionnaire", canonicals.join(","));
      if (to) params.append("authored", `le${to}T23:59:59`);
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
