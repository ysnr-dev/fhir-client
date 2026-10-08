import { useCallback, useRef, useState } from "react";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { fetchMissingPatients, searchExtractRecords, subjectIdOf } from "./extractRecords";

// 部門オーダーの実施記録の抽出(docs/data-extract-design.md §13)。種別 1 つの実施のハブ(partOf を持たない
// Procedure)を実施日の期間で引き、子の Procedure(2 件目以降の手技)・薬剤・測定値を _revinclude で、
// 元のオーダーヘッダを _include で、ヘッダにぶら下がる明細(依頼項目)を _revinclude:iterate で添える。

const PERFORM_PAGING = { page: 200, maxPages: 25 };

export interface PerformExtractCriteria {
  /** order-type のコード。 */
  orderType: string;
  from: string;
  to: string;
  /** 依頼科(オーダーの order-department)。 */
  departmentId?: string;
  patientIds?: string[];
}

export interface PerformExtractResult {
  hubs: fhir4.Procedure[];
  /** ハブの id → 子の Procedure。 */
  children: Map<string, fhir4.Procedure[]>;
  /** ハブ(か子)の id → 薬剤。 */
  administrations: Map<string, fhir4.MedicationAdministration[]>;
  /** ハブ(か子)の id → 測定値。 */
  observations: Map<string, fhir4.Observation[]>;
  /** ヘッダと明細の ServiceRequest。 */
  serviceRequests: fhir4.ServiceRequest[];
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

interface PerformExtractState {
  running: boolean;
  error: unknown;
  result: PerformExtractResult | null;
}

const IDLE: PerformExtractState = { running: false, error: null, result: null };

function partOfId(resource: { partOf?: fhir4.Reference[] }): string {
  const reference = resource.partOf?.[0]?.reference ?? "";
  return reference.startsWith("Procedure/") ? reference.slice("Procedure/".length) : "";
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** 実施記録の抽出の実行。条件を変えても自動では走らせない。 */
export function usePerformExtract() {
  const [state, setState] = useState<PerformExtractState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (criteria: PerformExtractCriteria) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setState({ running: true, error: null, result: null });
    try {
      const params = new URLSearchParams();
      params.set("category", `${ORDER_TYPE_SYSTEM}|${criteria.orderType}`);
      params.set("part-of:missing", "true");
      params.set("status:not", "entered-in-error");
      if (criteria.from) params.append("date", `ge${criteria.from}`);
      if (criteria.to) params.append("date", `le${criteria.to}`);
      if (criteria.departmentId) params.set("based-on.department", `Organization/${criteria.departmentId}`);
      params.append("_include", "Procedure:based-on");
      params.append("_revinclude", "Procedure:part-of");
      params.append("_revinclude", "MedicationAdministration:part-of");
      params.append("_revinclude", "Observation:part-of");
      params.append("_revinclude:iterate", "ServiceRequest:based-on");
      params.set("_sort", "-date");
      const page = await searchExtractRecords<fhir4.Procedure>(
        "Procedure",
        params,
        criteria.patientIds,
        signal,
        PERFORM_PAGING,
      );
      const children = new Map<string, fhir4.Procedure[]>();
      const administrations = new Map<string, fhir4.MedicationAdministration[]>();
      const observations = new Map<string, fhir4.Observation[]>();
      const serviceRequests: fhir4.ServiceRequest[] = [];
      for (const resource of page.included) {
        if (resource.resourceType === "Procedure") {
          const procedure = resource as fhir4.Procedure;
          if (procedure.status !== "entered-in-error") push(children, partOfId(procedure), procedure);
        } else if (resource.resourceType === "MedicationAdministration") {
          const administration = resource as fhir4.MedicationAdministration;
          if (administration.status !== "entered-in-error") push(administrations, partOfId(administration), administration);
        } else if (resource.resourceType === "Observation") {
          push(observations, partOfId(resource as fhir4.Observation), resource as fhir4.Observation);
        } else if (resource.resourceType === "ServiceRequest") {
          serviceRequests.push(resource as fhir4.ServiceRequest);
        }
      }
      await fetchMissingPatients(page.matches.map(subjectIdOf), page.patients, signal);
      setState({
        running: false,
        error: null,
        result: {
          hubs: page.matches,
          children,
          administrations,
          observations,
          serviceRequests,
          patients: page.patients,
          truncated: page.truncated,
        },
      });
    } catch (error) {
      setState({ running: false, error: signal.aborted ? null : error, result: null });
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { ...state, run, cancel };
}
