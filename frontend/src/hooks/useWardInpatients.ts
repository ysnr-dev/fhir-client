import { useMemo } from "react";
import { useBedWardIndex, useInpatientEncounters } from "../api/queries";
import { encounterBedId, encounterBedLabel, encounterPatientId } from "../fhir/encounterHelpers";

/** その日に病棟のベッドに居た患者 1 人。 */
export interface WardInpatient {
  patientId: string;
  patient?: fhir4.Patient;
  encounter: fhir4.Encounter;
  /** 「301号室 ベッド1」。 */
  bedLabel: string;
}

/**
 * その日にベッドの集合(病棟、または看護必要度の届出単位)のどれかに居た患者(病室・ベッド順)。
 * 入院患者一覧と同じキャッシュ(useInpatientEncounters)から絞る。
 */
export function useInpatientsAtBeds(date: string, bedIds: Set<string> | undefined, patientsLoading = false) {
  const inpatients = useInpatientEncounters(date);

  const rows = useMemo<WardInpatient[]>(() => {
    if (!bedIds) return [];
    const byPatient = new Map<string, WardInpatient>();
    for (const encounter of inpatients.data?.encounters ?? []) {
      const bedId = encounterBedId(encounter);
      if (!bedId || !bedIds.has(bedId)) continue;
      const patientId = encounterPatientId(encounter);
      if (!patientId || byPatient.has(patientId)) continue;
      byPatient.set(patientId, {
        patientId,
        patient: inpatients.data?.patientsById.get(patientId),
        encounter,
        bedLabel: encounterBedLabel(encounter),
      });
    }
    return [...byPatient.values()].sort((a, b) =>
      a.bedLabel.localeCompare(b.bedLabel, "ja", { numeric: true }),
    );
  }, [inpatients.data, bedIds]);

  return {
    rows,
    isLoading: inpatients.isLoading || patientsLoading,
    error: inpatients.error,
    truncated: inpatients.data?.truncated ?? false,
  };
}

/**
 * その日に病棟のベッドに居た患者(病室・ベッド順)。ベッドの属する病棟は useBedWardIndex で引く。
 */
export function useWardInpatients(date: string, wardId: string | undefined) {
  const bedWard = useBedWardIndex();
  const bedIds = useMemo(() => {
    if (!wardId) return undefined;
    const ids = new Set<string>();
    for (const [bedId, place] of bedWard.bedWards) if (place.wardId === wardId) ids.add(bedId);
    return ids;
  }, [bedWard.bedWards, wardId]);
  const result = useInpatientsAtBeds(date, bedIds, bedWard.isLoading);
  return { ...result, error: result.error ?? bedWard.error };
}
