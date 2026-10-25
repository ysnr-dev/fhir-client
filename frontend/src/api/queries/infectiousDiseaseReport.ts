import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { notifiableIcd10Tokens } from "../../fhir/infectiousDiseaseReportHelpers";
import { fetchConditionCandidates, fetchTemplateResponses } from "./cancerRegistry";

// 感染症の発生届の届出対象と届出(docs/infectious-disease-report-design.md §4)。
// 病名と回答の引き方は院内がん登録と同じ(ICD-10 のトークンと、テンプレートの全版の canonical)。

/** 届出対象の病名(開始日が from〜to)。 */
export function useNotifiableConditions(from: string, to: string) {
  return useQuery({
    queryKey: ["Condition", "search", "infectious-disease-report", from, to],
    queryFn: () => fetchConditionCandidates(notifiableIcd10Tokens(), from, to, new AbortController().signal),
    enabled: Boolean(from) && Boolean(to),
    placeholderData: keepPreviousData,
  });
}

/** 発生届のテンプレート(全版)への回答のうち、候補の患者のもの。 */
export function useInfectiousDiseaseReports(templateUrl: string, patientIds: string[]) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["QuestionnaireResponse", "search", "infectious-disease-report", templateUrl, ids.join(",")],
    queryFn: () => fetchTemplateResponses(templateUrl, ids, new AbortController().signal),
    enabled: Boolean(templateUrl),
    placeholderData: keepPreviousData,
  });
}
