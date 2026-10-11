import {
  PATHWAY_MARKER_CODE,
  PATHWAY_MARKER_SYSTEM,
  pathwayInstantiatesUri,
} from "../../fhir/pathwayApplyHelpers";
import { PATHWAY_APPLY_GOAL_ID_SYSTEM } from "../../fhir/pathwayCloseHelpers";
import { PATHWAY_OUTCOME_GOAL_ID_SYSTEM } from "../../fhir/pathwayEvaluationHelpers";
import { fetchMissingPatients, searchExtractRecords, subjectIdOf, useRecordExtract } from "./extractRecords";

// クリニカルパスの適用の抽出(docs/data-extract-design.md §14)。適用の CarePlan(木の根)を期間で引き、
// 入院を _include で添える。続けて、当たった患者のパスの Goal(適用の終了・中止と、アウトカムの評価)を
// identifier の system だけで 1 回に引き、識別子の前半(適用の識別子)で適用に結ぶ。

export interface PathwayExtractCriteria {
  from: string;
  to: string;
  /** パス定義のコード。指定したらそのパスの適用だけ。 */
  pathwayCode?: string;
  patientIds?: string[];
}

export interface PathwayExtractResult {
  applications: fhir4.CarePlan[];
  encounters: Map<string, fhir4.Encounter>;
  goals: fhir4.Goal[];
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

/** パスの適用の抽出を読む(docs/data-extract-design.md)。中止は signal で伝える。 */
export async function fetchPathwayExtract(
  criteria: PathwayExtractCriteria,
  signal: AbortSignal,
): Promise<PathwayExtractResult> {
  const params = new URLSearchParams();
  params.set("category", `${PATHWAY_MARKER_SYSTEM}|${PATHWAY_MARKER_CODE}`);
  params.set("part-of:missing", "true");
  params.set("status:not", "entered-in-error");
  if (criteria.from) params.append("date", `ge${criteria.from}`);
  if (criteria.to) params.append("date", `le${criteria.to}`);
  if (criteria.pathwayCode) params.set("instantiates-uri", pathwayInstantiatesUri(criteria.pathwayCode));
  params.append("_include", "CarePlan:encounter");
  params.set("_sort", "-date");
  const roots = await searchExtractRecords<fhir4.CarePlan>("CarePlan", params, criteria.patientIds, signal);
  const encounters = new Map<string, fhir4.Encounter>();
  for (const resource of roots.included) {
    if (resource.resourceType === "Encounter" && resource.id) encounters.set(resource.id, resource as fhir4.Encounter);
  }

  // 当たった適用の患者ぶんの Goal。適用が無ければ引かない。
  const patientIds = [...new Set(roots.matches.map(subjectIdOf).filter(Boolean))];
  let goals: fhir4.Goal[] = [];
  let truncated = roots.truncated;
  if (patientIds.length > 0) {
    const goalParams = new URLSearchParams();
    goalParams.set("identifier", `${PATHWAY_APPLY_GOAL_ID_SYSTEM}|,${PATHWAY_OUTCOME_GOAL_ID_SYSTEM}|`);
    const goalPage = await searchExtractRecords<fhir4.Goal>("Goal", goalParams, patientIds, signal);
    goals = goalPage.matches;
    truncated ||= goalPage.truncated;
  }
  await fetchMissingPatients(patientIds, roots.patients, signal);
  return { applications: roots.matches, encounters, goals, patients: roots.patients, truncated };
}

/** パスの適用の抽出の実行。条件を変えても自動では走らせない。 */
export function usePathwayExtract() {
  return useRecordExtract(fetchPathwayExtract);
}
