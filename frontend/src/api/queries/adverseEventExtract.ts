import { useCallback, useRef, useState } from "react";
import { ADVERSE_EVENT_CATEGORY, type TreatmentType } from "../../fhir/adverseEventHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { fetchMissingPatients, searchExtractRecords, subjectIdOf } from "./extractRecords";

// 有害事象の抽出(docs/data-extract-design.md §12)。有害事象の Observation を発現日(effectivePeriod.start)の
// 期間で引く。治療の種別は原因の治療のヘッダ(basedOn)の order-type を、用語は code.text の完全一致で上流が絞る。

export interface AdverseEventExtractCriteria {
  from: string;
  to: string;
  treatmentType?: TreatmentType;
  /** CTCAE 用語(code.text)。どれかに一致する記録。 */
  terms?: string[];
  patientIds?: string[];
}

export interface AdverseEventExtractResult {
  observations: fhir4.Observation[];
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

interface AdverseEventExtractState {
  running: boolean;
  error: unknown;
  result: AdverseEventExtractResult | null;
}

const IDLE: AdverseEventExtractState = { running: false, error: null, result: null };

/** 有害事象の抽出の実行。条件を変えても自動では走らせない。 */
export function useAdverseEventExtract() {
  const [state, setState] = useState<AdverseEventExtractState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (criteria: AdverseEventExtractCriteria) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setState({ running: true, error: null, result: null });
    try {
      const params = new URLSearchParams();
      params.set("category", ADVERSE_EVENT_CATEGORY.code);
      if (criteria.from) params.append("date", `ge${criteria.from}`);
      if (criteria.to) params.append("date", `le${criteria.to}`);
      params.set("status:not", "entered-in-error,cancelled");
      if (criteria.treatmentType) params.set("based-on.category", `${ORDER_TYPE_SYSTEM}|${criteria.treatmentType}`);
      if (criteria.terms?.length) params.set("code:exact", criteria.terms.join(","));
      params.set("_sort", "-date");
      const page = await searchExtractRecords<fhir4.Observation>("Observation", params, criteria.patientIds, signal);
      await fetchMissingPatients(page.matches.map(subjectIdOf), page.patients, signal);
      setState({
        running: false,
        error: null,
        result: { observations: page.matches, patients: page.patients, truncated: page.truncated },
      });
    } catch (error) {
      setState({ running: false, error: signal.aborted ? null : error, result: null });
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { ...state, run, cancel };
}
