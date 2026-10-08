import { useCallback, useRef, useState } from "react";
import { SSMIX2_DEPARTMENT_CODE_SYSTEM } from "../../fhir/departmentCodes";
import {
  ADMISSION_CLASS_CODE,
  ADMISSION_STATUS,
  DISCHARGED_STATUS,
} from "../../fhir/encounterHelpers";
import type { AdmissionDateMode } from "../../fhir/extractQueryHelpers";
import { OUTPATIENT_CLASS_CODE } from "../../fhir/outpatientEncounterHelpers";
import { addDays } from "../../lib/dates";
import { fetchMissingPatients, searchExtractRecords, subjectIdOf } from "./extractRecords";

// 入院・外来の抽出(docs/data-extract-design.md §19)。入院(class=IMP)か外来受診(class=AMB)の Encounter を
// 期間で引く。入院はベッド → 病室 → 病棟を _include(:iterate)で、外来は受付(Appointment)を _include で添える。

export type EncounterExtractKind = "inpatient" | "outpatient";

export interface EncounterExtractCriteria {
  kind: EncounterExtractKind;
  from: string;
  to: string;
  /** 入院の期間の見方(期間中に入院していた / 入院した / 退院した)。 */
  dateMode: AdmissionDateMode;
  /** 入院は診療科(serviceProvider)の id、外来は受付の診療科の SS-MIX2 コード。 */
  departmentId?: string;
  departmentCode?: string;
  /** 入院の病棟。ベッド → 病室 → 病棟のチェーンで絞る。 */
  wardId?: string;
  patientIds?: string[];
}

export interface EncounterExtractResult {
  kind: EncounterExtractKind;
  encounters: fhir4.Encounter[];
  locations: Map<string, fhir4.Location>;
  appointments: Map<string, fhir4.Appointment>;
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

interface EncounterExtractState {
  running: boolean;
  error: unknown;
  result: EncounterExtractResult | null;
}

const IDLE: EncounterExtractState = { running: false, error: null, result: null };

function inpatientParams(criteria: EncounterExtractCriteria): URLSearchParams {
  const params = new URLSearchParams();
  params.set("class", ADMISSION_CLASS_CODE);
  params.set("status", `${ADMISSION_STATUS},${DISCHARGED_STATUS}`);
  // Encounter.date は入院期間との比較。sa / eb で入院日・退院日だけを見る(「患者」タブの入院の条件と同じ)。
  if (criteria.dateMode === "admitted") {
    if (criteria.from) params.append("date", `sa${addDays(criteria.from, -1)}`);
    if (criteria.to) params.append("date", `le${criteria.to}`);
  } else if (criteria.dateMode === "discharged") {
    if (criteria.from) params.append("date", `ge${criteria.from}`);
    if (criteria.to) params.append("date", `eb${addDays(criteria.to, 1)}`);
  } else {
    if (criteria.from) params.append("date", `ge${criteria.from}`);
    if (criteria.to) params.append("date", `le${criteria.to}`);
  }
  if (criteria.departmentId) params.set("service-provider", `Organization/${criteria.departmentId}`);
  if (criteria.wardId) params.set("location.partof.partof", `Location/${criteria.wardId}`);
  params.append("_include", "Encounter:location");
  params.append("_include:iterate", "Location:partof");
  return params;
}

function outpatientParams(criteria: EncounterExtractCriteria): URLSearchParams {
  const params = new URLSearchParams();
  params.set("class", OUTPATIENT_CLASS_CODE);
  params.set("status:not", "cancelled,entered-in-error");
  if (criteria.from) params.append("date", `ge${criteria.from}`);
  if (criteria.to) params.append("date", `le${criteria.to}`);
  // 外来の Encounter は診療科を持たないので、受付(Appointment)の診療科で絞る。
  if (criteria.departmentCode) {
    params.set("appointment.specialty", `${SSMIX2_DEPARTMENT_CODE_SYSTEM}|${criteria.departmentCode}`);
  }
  params.append("_include", "Encounter:appointment");
  return params;
}

/** 入院・外来の抽出の実行。条件を変えても自動では走らせない。 */
export function useEncounterExtract() {
  const [state, setState] = useState<EncounterExtractState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (criteria: EncounterExtractCriteria) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setState({ running: true, error: null, result: null });
    try {
      const params = criteria.kind === "inpatient" ? inpatientParams(criteria) : outpatientParams(criteria);
      params.set("_sort", "-date");
      const page = await searchExtractRecords<fhir4.Encounter>("Encounter", params, criteria.patientIds, signal);
      const locations = new Map<string, fhir4.Location>();
      const appointments = new Map<string, fhir4.Appointment>();
      for (const resource of page.included) {
        if (!resource.id) continue;
        if (resource.resourceType === "Location") locations.set(resource.id, resource as fhir4.Location);
        if (resource.resourceType === "Appointment") appointments.set(resource.id, resource as fhir4.Appointment);
      }
      await fetchMissingPatients(page.matches.map(subjectIdOf), page.patients, signal);
      setState({
        running: false,
        error: null,
        result: {
          kind: criteria.kind,
          encounters: page.matches,
          locations,
          appointments,
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
