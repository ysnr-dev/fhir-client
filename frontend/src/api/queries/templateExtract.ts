import { questionnaireCanonical } from "../../fhir/questionnaireResponseHelpers";
import { searchResource } from "../fhirClient";
import { fetchMissingPatients, searchExtractRecords, subjectIdOf, useRecordExtract } from "./extractRecords";

// テンプレートの抽出(docs/data-extract-design.md §8)。同じ url の全版の回答を、記入日の期間で
// 1 本の検索にして読む(questionnaire はカンマで OR、患者は _include で添える)。患者の条件で
// 絞るときは、該当した患者を subject= に 100 人ずつ並べて同じ検索をする。

export interface TemplateExtractCriteria {
  url: string;
  from: string;
  to: string;
  departmentId?: string;
  /** 患者の条件に該当した患者。指定したらこの患者の回答だけを読む。 */
  patientIds?: string[];
}

export interface TemplateExtractResult {
  questionnaires: fhir4.Questionnaire[];
  responses: fhir4.QuestionnaireResponse[];
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
  ranAt: string;
}



async function fetchVersions(url: string, signal: AbortSignal): Promise<fhir4.Questionnaire[]> {
  const params = new URLSearchParams({ url, _count: "100" });
  const { data } = await searchResource<fhir4.Questionnaire>("Questionnaire", params, { strict: true, signal });
  return (data.entry ?? [])
    .map((entry) => entry.resource)
    .filter((r): r is fhir4.Questionnaire => r?.resourceType === "Questionnaire");
}

/** テンプレートの抽出を読む(docs/data-extract-design.md)。中止は signal で伝える。 */
export async function fetchTemplateExtract(
  criteria: TemplateExtractCriteria,
  signal: AbortSignal,
): Promise<TemplateExtractResult> {
  const questionnaires = await fetchVersions(criteria.url, signal);
  const canonicals = [...new Set(questionnaires.map(questionnaireCanonical))];
  if (canonicals.length === 0) {
    return { questionnaires, responses: [], patients: new Map(), truncated: false, ranAt: new Date().toISOString() };
  }
  const params = new URLSearchParams();
  params.set("questionnaire", canonicals.join(","));
  if (criteria.from) params.append("authored", `ge${criteria.from}`);
  if (criteria.to) params.append("authored", `le${criteria.to}`);
  params.set("status", "in-progress,completed,amended");
  if (criteria.departmentId) params.set("department", `Organization/${criteria.departmentId}`);
  params.set("_sort", "-authored");
  const { matches, patients, truncated } = await searchExtractRecords<fhir4.QuestionnaireResponse>(
    "QuestionnaireResponse",
    params,
    criteria.patientIds,
    signal,
  );
  await fetchMissingPatients(matches.map(subjectIdOf), patients, signal);
  return { questionnaires, responses: matches, patients, truncated, ranAt: new Date().toISOString() };
}

/** テンプレートの抽出の実行。条件を変えても自動では走らせない。 */
export function useTemplateExtract() {
  return useRecordExtract(fetchTemplateExtract);
}
