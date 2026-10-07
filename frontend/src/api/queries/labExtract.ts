import { useCallback, useRef, useState } from "react";
import { fetchMissingPatients, searchExtractRecords, subjectIdOf } from "./extractRecords";

// 検査結果の抽出(docs/data-extract-design.md §9)。選んだ項目のコードで Observation を
// 測定日の期間で引く。コードが多いときは 100 件ずつに分けて引き、記録を合わせる(URL の長さ)。

const CODE_CHUNK = 100;

export interface LabExtractCriteria {
  codings: fhir4.Coding[];
  from: string;
  to: string;
  departmentId?: string;
  /** 指定したらこの患者の記録だけを読む。 */
  patientIds?: string[];
}

export interface LabExtractResult {
  observations: fhir4.Observation[];
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

interface LabExtractState {
  running: boolean;
  error: unknown;
  result: LabExtractResult | null;
}

const IDLE: LabExtractState = { running: false, error: null, result: null };

/** 検査結果の抽出の実行。条件を変えても自動では走らせない。 */
export function useLabExtract() {
  const [state, setState] = useState<LabExtractState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (criteria: LabExtractCriteria) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setState({ running: true, error: null, result: null });
    try {
      const tokens = [
        ...new Set(criteria.codings.filter((c) => c.system && c.code).map((c) => `${c.system}|${c.code}`)),
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
      setState({ running: false, error: null, result: { observations: matches, patients, truncated } });
    } catch (error) {
      setState({ running: false, error: signal.aborted ? null : error, result: null });
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { ...state, run, cancel };
}
