import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  compareEmergencyEncounters,
  EMERGENCY_ACTIVE_STATUSES,
  EMERGENCY_CANCELLED_STATUS,
  EMERGENCY_CLASS_CODE,
  EMERGENCY_OBSERVATION_SYSTEM,
  JTAS_OBSERVATION_CODE,
  parseTriageObservation,
  type TriageRecord,
} from "../../fhir/emergencyEncounterHelpers";
import { referenceId, transactionBundle } from "../../fhir/shared";
import { postBundle, searchResource } from "../fhirClient";
import { resourcesOfType, searchAllPages } from "./core";

// ---- 救急患者一覧 ----
//
// 滞在中(日付を問わない)と、指定日に来院した受診を 2 本で引いて突き合わせる。
// 滞在中は日をまたいでも常に出したいので、日付では絞らない方の検索で拾う。

/** 一覧の 1 行。救急の受診(Encounter)1 件ぶん。 */
export interface EmergencyRow {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
}

export interface EmergencyListResult {
  rows: EmergencyRow[];
  /** 取得の上限に達し、一部の受診が欠けている。 */
  truncated: boolean;
}

const EMERGENCY_PAGE = 500;
const EMERGENCY_MAX_PAGES = 2;

async function searchEmergencyEncounters(
  params: URLSearchParams,
): Promise<{ encounters: fhir4.Encounter[]; patients: fhir4.Patient[]; truncated: boolean }> {
  params.set("class", EMERGENCY_CLASS_CODE);
  params.set("_include", "Encounter:subject");
  const { matches, bundles, truncated } = await searchAllPages<fhir4.Encounter>("Encounter", params, {
    page: EMERGENCY_PAGE,
    maxPages: EMERGENCY_MAX_PAGES,
  });
  const patients = bundles.flatMap((bundle) => resourcesOfType<fhir4.Patient>(bundle, "Patient"));
  return { encounters: matches, patients, truncated };
}

async function fetchEmergencyList(date: string): Promise<EmergencyListResult> {
  const active = new URLSearchParams();
  active.set("status", EMERGENCY_ACTIVE_STATUSES.join(","));

  const ofDay = new URLSearchParams();
  // 同じ名前を 2 回渡すと期間の重なり(fetchInpatients と同じ手)。
  ofDay.append("date", `ge${date}`);
  ofDay.append("date", `le${date}`);
  ofDay.set("status:not", EMERGENCY_CANCELLED_STATUS);

  const [a, b] = await Promise.all([searchEmergencyEncounters(active), searchEmergencyEncounters(ofDay)]);

  const encountersById = new Map<string, fhir4.Encounter>();
  for (const encounter of [...a.encounters, ...b.encounters]) {
    if (encounter.id && encounter.status !== EMERGENCY_CANCELLED_STATUS) {
      encountersById.set(encounter.id, encounter);
    }
  }
  const patientsById = new Map<string, fhir4.Patient>();
  for (const patient of [...a.patients, ...b.patients]) {
    if (patient.id) patientsById.set(patient.id, patient);
  }

  const rows = [...encountersById.values()]
    .sort(compareEmergencyEncounters)
    .map((encounter) => ({
      encounter,
      patient: patientsById.get(referenceId(encounter.subject?.reference) ?? ""),
    }));
  return { rows, truncated: a.truncated || b.truncated };
}

export const EMERGENCY_POLLING_INTERVAL = 60_000;

export function useEmergencyList(date: string, options: { polling?: boolean } = {}) {
  return useQuery({
    queryKey: ["Encounter", "emergency", date],
    queryFn: () => fetchEmergencyList(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
    refetchInterval: options.polling ? EMERGENCY_POLLING_INTERVAL : false,
  });
}

function invalidateEmergency(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["Encounter"] });
  queryClient.invalidateQueries({ queryKey: ["Observation", "emergency-triage"] });
}

/**
 * 救急受付。受診と(トリアージを入れたときは)判定記録を 1 本の transaction で書く。
 * 判定記録は受診を参照するので、受診は仮 id(urn:uuid)で建てる。
 */
export function useEmergencyCheckIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      encounter,
      triage,
    }: {
      encounter: fhir4.Encounter;
      triage?: (encounterRef: string) => fhir4.Observation;
    }) => {
      const fullUrl = `urn:uuid:${crypto.randomUUID()}`;
      const entry: fhir4.BundleEntry[] = [
        { fullUrl, resource: encounter, request: { method: "POST", url: "Encounter" } },
      ];
      if (triage) {
        entry.push({ resource: triage(fullUrl), request: { method: "POST", url: "Observation" } });
      }
      return postBundle(transactionBundle(entry));
    },
    onSuccess: () => invalidateEmergency(queryClient),
  });
}

/**
 * 受診を書き換える(状態の遷移・トリアージ・ベッドや担当医の変更・転帰)。一覧が読んだ
 * 版は postBundle が ifMatch に添える。
 */
export function useUpdateEmergencyEncounter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      encounter,
      observation,
    }: {
      encounter: fhir4.Encounter;
      observation?: fhir4.Observation;
    }) => {
      const entry: fhir4.BundleEntry[] = [
        { resource: encounter, request: { method: "PUT", url: `Encounter/${encounter.id}` } },
      ];
      if (observation) {
        entry.push({ resource: observation, request: { method: "POST", url: "Observation" } });
      }
      return postBundle(transactionBundle(entry));
    },
    onSuccess: () => invalidateEmergency(queryClient),
  });
}

/** トリアージの判定履歴(新しい順)。 */
export function useEmergencyTriageHistory(encounterId: string | undefined) {
  return useQuery({
    queryKey: ["Observation", "emergency-triage", encounterId],
    queryFn: async (): Promise<TriageRecord[]> => {
      const params = new URLSearchParams();
      params.set("encounter", `Encounter/${encounterId}`);
      params.set("code", `${EMERGENCY_OBSERVATION_SYSTEM}|${JTAS_OBSERVATION_CODE}`);
      params.set("_count", "50");
      const { data: bundle } = await searchResource<fhir4.Observation>("Observation", params);
      return resourcesOfType<fhir4.Observation>(bundle, "Observation")
        .map(parseTriageObservation)
        .filter((r): r is TriageRecord => r !== null)
        .sort((x, y) => y.at.localeCompare(x.at));
    },
    enabled: Boolean(encounterId),
  });
}

/** その患者がいま救急に滞在中ならその受診。滞在中でなければ null。 */
export function usePatientEmergency(patientId: string | undefined) {
  return useQuery({
    queryKey: ["Encounter", "patient-emergency", patientId],
    queryFn: async (): Promise<fhir4.Encounter | null> => {
      const params = new URLSearchParams();
      params.set("subject", `Patient/${patientId}`);
      params.set("class", EMERGENCY_CLASS_CODE);
      params.set("status", EMERGENCY_ACTIVE_STATUSES.join(","));
      params.set("_count", "10");
      const { data: bundle } = await searchResource<fhir4.Encounter>("Encounter", params);
      const encounters = resourcesOfType<fhir4.Encounter>(bundle, "Encounter");
      // 同じ患者の滞在が 2 件並ぶことは無い想定だが、あれば来院が新しい方を採る。
      return (
        encounters.reduce<fhir4.Encounter | undefined>(
          (latest, current) =>
            !latest || (current.period?.start ?? "") > (latest.period?.start ?? "") ? current : latest,
          undefined,
        ) ?? null
      );
    },
    enabled: Boolean(patientId),
  });
}

/**
 * 身元不明で仮登録した患者の身元が分かったときの書き換え。
 */
export function useIdentifyProvisionalPatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patient: fhir4.Patient) =>
      postBundle(
        transactionBundle([
          { resource: patient, request: { method: "PUT", url: `Patient/${patient.id}` } },
        ]),
      ),
    onSuccess: (_result, patient) => {
      invalidateEmergency(queryClient);
      queryClient.invalidateQueries({ queryKey: ["Patient", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Patient", patient.id] });
    },
  });
}
