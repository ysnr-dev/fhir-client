import { chartItemCodings, type ChartItem } from "../../fhir/chartDefinitionHelpers";
import { fetchMissingPatients, searchExtractRecords, subjectIdOf, useRecordExtract } from "./extractRecords";

// 検査結果の抽出(docs/data-extract-design.md §9)。選んだ項目のコードで Observation を
// 測定日の期間で引く。コードが多いときは 100 件ずつに分けて引き、記録を合わせる(URL の長さ)。

const CODE_CHUNK = 100;

export interface LabExtractCriteria {
  /** 検査・バイタルの項目。コードに展開して引き、表の列もこの項目で組む。 */
  items: ChartItem[];
  from: string;
  to: string;
  departmentId?: string;
  /** 指定したらこの患者の記録だけを読む。 */
  patientIds?: string[];
}

export interface LabExtractResult {
  items: ChartItem[];
  observations: fhir4.Observation[];
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

/** 検査結果の抽出を読む(docs/data-extract-design.md)。中止は signal で伝える。 */
export async function fetchLabExtract(criteria: LabExtractCriteria, signal: AbortSignal): Promise<LabExtractResult> {
  const tokens = [
    ...new Set(chartItemCodings(criteria.items).filter((c) => c.system && c.code).map((c) => `${c.system}|${c.code}`)),
  ];
  const observations = new Map<string, fhir4.Observation>();
  const patients = new Map<string, fhir4.Patient>();
  let truncated = false;
  for (let i = 0; i < tokens.length; i += CODE_CHUNK) {
    const params = new URLSearchParams();
    params.set("code", tokens.slice(i, i + CODE_CHUNK).join(","));
    if (criteria.from) params.append("date", `ge${criteria.from}`);
    if (criteria.to) params.append("date", `le${criteria.to}`);
    params.set("status:not", "entered-in-error,cancelled");
    if (criteria.departmentId) params.set("department", `Organization/${criteria.departmentId}`);
    params.set("_sort", "-date");
    const page = await searchExtractRecords<fhir4.Observation>("Observation", params, criteria.patientIds, signal);
    for (const observation of page.matches) observations.set(observation.id ?? `${observations.size}`, observation);
    for (const [id, patient] of page.patients) patients.set(id, patient);
    truncated ||= page.truncated;
  }
  const matches = [...observations.values()];
  await fetchMissingPatients(matches.map(subjectIdOf), patients, signal);
  return { items: criteria.items, observations: matches, patients, truncated };
}

/** 検査結果の抽出の実行。条件を変えても自動では走らせない。 */
export function useLabExtract() {
  return useRecordExtract(fetchLabExtract);
}
