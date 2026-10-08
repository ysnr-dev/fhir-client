import { useCallback, useRef, useState } from "react";
import type { ExtractCode, ExtractDrugClass, ExtractOrderType } from "../../fhir/extractQueryHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { MEDICINE_CODE_SYSTEM } from "../../fhir/prescriptionHelpers";
import { fetchMedicineCodesByClass } from "../masterClient";
import { fetchMissingPatients, searchExtractRecords, subjectIdOf } from "./extractRecords";

// 投薬の抽出(docs/data-extract-design.md §15)。処方・注射のオーダーの薬剤(MedicationRequest)を
// オーダー日の期間で引き、オーダーヘッダ(区分・入外・開始日・依頼科)を _include で添える。
// 薬効分類は実行のたびに医薬品マスタで医薬品コードに展開し、薬剤と合わせて 100 件ずつ code= で引く。

const CODE_CHUNK = 100;

export interface MedicationExtractCriteria {
  codes: ExtractCode[];
  drugClasses: ExtractDrugClass[];
  orderType?: ExtractOrderType;
  from: string;
  to: string;
  departmentId?: string;
  patientIds?: string[];
}

export interface MedicationExtractResult {
  requests: fhir4.MedicationRequest[];
  headers: Map<string, fhir4.ServiceRequest>;
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

interface MedicationExtractState {
  running: boolean;
  error: unknown;
  result: MedicationExtractResult | null;
}

const IDLE: MedicationExtractState = { running: false, error: null, result: null };

/** 投薬の抽出の実行。条件を変えても自動では走らせない。 */
export function useMedicationExtract() {
  const [state, setState] = useState<MedicationExtractState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (criteria: MedicationExtractCriteria) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setState({ running: true, error: null, result: null });
    try {
      const tokens = new Set(criteria.codes.map((c) => `${c.system}|${c.code}`));
      if (criteria.drugClasses.length > 0) {
        const codes = await fetchMedicineCodesByClass(criteria.drugClasses.map((c) => c.code));
        for (const code of codes) tokens.add(`${MEDICINE_CODE_SYSTEM}|${code}`);
        // 薬効分類に当たる薬が 1 つも無ければ、何も当たらない(全件を引かない)。
        if (tokens.size === 0) {
          setState({ running: false, error: null, result: { requests: [], headers: new Map(), patients: new Map(), truncated: false } });
          return;
        }
      }
      const base = new URLSearchParams();
      if (criteria.from) base.append("authoredon", `ge${criteria.from}`);
      if (criteria.to) base.append("authoredon", `le${criteria.to}`);
      base.set("status:not", "entered-in-error,cancelled");
      if (criteria.orderType) base.set("based-on.category", `${ORDER_TYPE_SYSTEM}|${criteria.orderType}`);
      if (criteria.departmentId) base.set("based-on.department", `Organization/${criteria.departmentId}`);
      base.append("_include", "MedicationRequest:based-on");
      base.set("_sort", "-authoredon");

      const tokenList = [...tokens];
      const searches: URLSearchParams[] = [];
      if (tokenList.length === 0) {
        searches.push(base);
      } else {
        for (let i = 0; i < tokenList.length; i += CODE_CHUNK) {
          const params = new URLSearchParams(base);
          params.set("code", tokenList.slice(i, i + CODE_CHUNK).join(","));
          searches.push(params);
        }
      }

      const requests = new Map<string, fhir4.MedicationRequest>();
      const headers = new Map<string, fhir4.ServiceRequest>();
      const patients = new Map<string, fhir4.Patient>();
      let truncated = false;
      for (const params of searches) {
        const page = await searchExtractRecords<fhir4.MedicationRequest>(
          "MedicationRequest",
          params,
          criteria.patientIds,
          signal,
        );
        for (const request of page.matches) requests.set(request.id ?? `${requests.size}`, request);
        for (const resource of page.included) {
          if (resource.resourceType === "ServiceRequest" && resource.id) headers.set(resource.id, resource as fhir4.ServiceRequest);
        }
        for (const [id, patient] of page.patients) patients.set(id, patient);
        truncated ||= page.truncated;
      }
      const matches = [...requests.values()];
      await fetchMissingPatients(matches.map(subjectIdOf), patients, signal);
      setState({ running: false, error: null, result: { requests: matches, headers, patients, truncated } });
    } catch (error) {
      setState({ running: false, error: signal.aborted ? null : error, result: null });
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { ...state, run, cancel };
}
