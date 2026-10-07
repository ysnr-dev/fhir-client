import { useCallback, useRef, useState } from "react";
import { fetchMissingPatients, searchExtractRecords, subjectIdOf } from "./extractRecords";

// 細菌検査の抽出(docs/data-extract-design.md §10)。細菌検査結果のレポート(category=MB)を
// 採取日の期間で引き、結果(培養・分離菌・感受性の Observation)と検体を _include で添える。
// 1 レポートに Observation が数十件添うので、1 ページは 100 レポートにする。

const MICRO_PAGING = { page: 100, maxPages: 50 };

export interface MicroExtractCriteria {
  from: string;
  to: string;
  /** 指定したらこの患者の結果だけを読む。 */
  patientIds?: string[];
}

export interface MicroExtractResult {
  reports: fhir4.DiagnosticReport[];
  observations: Map<string, fhir4.Observation>;
  specimens: Map<string, fhir4.Specimen>;
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

interface MicroExtractState {
  running: boolean;
  error: unknown;
  result: MicroExtractResult | null;
}

const IDLE: MicroExtractState = { running: false, error: null, result: null };

/** 細菌検査の抽出の実行。条件を変えても自動では走らせない。 */
export function useMicroExtract() {
  const [state, setState] = useState<MicroExtractState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (criteria: MicroExtractCriteria) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setState({ running: true, error: null, result: null });
    try {
      const params = new URLSearchParams();
      params.set("category", "MB");
      if (criteria.from) params.append("date", `ge${criteria.from}`);
      if (criteria.to) params.append("date", `le${criteria.to}`);
      params.set("status:not", "entered-in-error,cancelled");
      params.append("_include", "DiagnosticReport:result");
      params.append("_include", "DiagnosticReport:specimen");
      params.set("_sort", "-date");
      const page = await searchExtractRecords<fhir4.DiagnosticReport>(
        "DiagnosticReport",
        params,
        criteria.patientIds,
        signal,
        MICRO_PAGING,
      );
      const observations = new Map<string, fhir4.Observation>();
      const specimens = new Map<string, fhir4.Specimen>();
      for (const resource of page.included) {
        if (!resource.id) continue;
        if (resource.resourceType === "Observation") observations.set(resource.id, resource as fhir4.Observation);
        if (resource.resourceType === "Specimen") specimens.set(resource.id, resource as fhir4.Specimen);
      }
      await fetchMissingPatients(page.matches.map(subjectIdOf), page.patients, signal);
      setState({
        running: false,
        error: null,
        result: { reports: page.matches, observations, specimens, patients: page.patients, truncated: page.truncated },
      });
    } catch (error) {
      setState({ running: false, error: signal.aborted ? null : error, result: null });
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { ...state, run, cancel };
}
