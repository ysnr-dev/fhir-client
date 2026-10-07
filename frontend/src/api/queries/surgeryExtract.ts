import { useCallback, useRef, useState } from "react";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { SURGERY_ORDER_TYPE } from "../../fhir/surgeryOrderHelpers";
import { SURGERY_PROCEDURE_CODE_SYSTEM } from "../../fhir/surgeryResultHelpers";
import { fetchMissingPatients, searchExtractRecords, subjectIdOf } from "./extractRecords";

// 手術実績の抽出(docs/data-extract-design.md §11)。手術の実施記録のハブ(partOf を持たない Procedure)を
// 入室日の期間で引き、子の Procedure(2 件目以降の術式・麻酔)と測定値の Observation(出血量など)を
// _revinclude で、元の手術オーダー(ヘッダ)を _include で添える。術式で絞るときは、主術式(ハブの code)で
// 当たる手術と、2 件目以降の術式(子の code。`_has:Procedure:part-of:code`)で当たる手術を別々に引いて合わせる。

const SURGERY_PAGING = { page: 200, maxPages: 25 };

export interface SurgeryExtractCriteria {
  from: string;
  to: string;
  /** 依頼科(オーダーの order-department)。 */
  departmentId?: string;
  /** 実施した術式・麻酔の手技料(レセ電算コード)。どれか 1 つを含む手術。 */
  procedureCodes?: string[];
  patientIds?: string[];
}

export interface SurgeryExtractResult {
  hubs: fhir4.Procedure[];
  /** ハブの id → 子の Procedure。 */
  children: Map<string, fhir4.Procedure[]>;
  /** ハブ(か子)の id → 測定値。 */
  observations: Map<string, fhir4.Observation[]>;
  orders: Map<string, fhir4.ServiceRequest>;
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

interface SurgeryExtractState {
  running: boolean;
  error: unknown;
  result: SurgeryExtractResult | null;
}

const IDLE: SurgeryExtractState = { running: false, error: null, result: null };

function partOfId(resource: { partOf?: fhir4.Reference[] }): string {
  const reference = resource.partOf?.[0]?.reference ?? "";
  return reference.startsWith("Procedure/") ? reference.slice("Procedure/".length) : "";
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** 手術実績の抽出の実行。条件を変えても自動では走らせない。 */
export function useSurgeryExtract() {
  const [state, setState] = useState<SurgeryExtractState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (criteria: SurgeryExtractCriteria) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setState({ running: true, error: null, result: null });
    try {
      const params = new URLSearchParams();
      params.set("category", `${ORDER_TYPE_SYSTEM}|${SURGERY_ORDER_TYPE.code}`);
      params.set("part-of:missing", "true");
      params.set("status:not", "entered-in-error");
      if (criteria.from) params.append("date", `ge${criteria.from}`);
      if (criteria.to) params.append("date", `le${criteria.to}`);
      if (criteria.departmentId) params.set("based-on.department", `Organization/${criteria.departmentId}`);
      params.append("_include", "Procedure:based-on");
      params.append("_revinclude", "Procedure:part-of");
      params.append("_revinclude", "Observation:part-of");
      params.set("_sort", "-date");
      const searches: URLSearchParams[] = [];
      if (criteria.procedureCodes?.length) {
        const tokens = criteria.procedureCodes.map((code) => `${SURGERY_PROCEDURE_CODE_SYSTEM}|${code}`).join(",");
        const byHub = new URLSearchParams(params);
        byHub.set("code", tokens);
        const byChild = new URLSearchParams(params);
        byChild.set("_has:Procedure:part-of:code", tokens);
        searches.push(byHub, byChild);
      } else {
        searches.push(params);
      }
      const hubs = new Map<string, fhir4.Procedure>();
      const patients = new Map<string, fhir4.Patient>();
      const included: fhir4.Resource[] = [];
      let truncated = false;
      for (const search of searches) {
        const page = await searchExtractRecords<fhir4.Procedure>(
          "Procedure",
          search,
          criteria.patientIds,
          signal,
          SURGERY_PAGING,
        );
        for (const hub of page.matches) hubs.set(hub.id ?? `${hubs.size}`, hub);
        for (const [id, patient] of page.patients) patients.set(id, patient);
        included.push(...page.included);
        truncated ||= page.truncated;
      }
      const children = new Map<string, fhir4.Procedure[]>();
      const observations = new Map<string, fhir4.Observation[]>();
      const orders = new Map<string, fhir4.ServiceRequest>();
      const seen = new Set<string>();
      for (const resource of included) {
        const key = `${resource.resourceType}/${resource.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (resource.resourceType === "Procedure") {
          const procedure = resource as fhir4.Procedure;
          if (procedure.status !== "entered-in-error") push(children, partOfId(procedure), procedure);
        } else if (resource.resourceType === "Observation") {
          push(observations, partOfId(resource as fhir4.Observation), resource as fhir4.Observation);
        } else if (resource.resourceType === "ServiceRequest" && resource.id) {
          orders.set(resource.id, resource as fhir4.ServiceRequest);
        }
      }
      const matches = [...hubs.values()];
      await fetchMissingPatients(matches.map(subjectIdOf), patients, signal);
      setState({
        running: false,
        error: null,
        result: {
          hubs: matches,
          children,
          observations,
          orders,
          patients,
          truncated,
        },
      });
    } catch (error) {
      setState({ running: false, error: signal.aborted ? null : error, result: null });
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { ...state, run, cancel };
}
