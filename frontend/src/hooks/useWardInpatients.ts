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
 * その日に病棟のベッドに居た患者(病室・ベッド順)。入院患者一覧と同じキャッシュ
 * (useInpatientEncounters + useBedWardIndex)から、ベッドの属する病棟で絞る。
 */
export function useWardInpatients(date: string, wardId: string | undefined) {
  const inpatients = useInpatientEncounters(date);
  const bedWard = useBedWardIndex();

  const rows = useMemo<WardInpatient[]>(() => {
    if (!wardId) return [];
    const byPatient = new Map<string, WardInpatient>();
    for (const encounter of inpatients.data?.encounters ?? []) {
      const bedId = encounterBedId(encounter);
      if (!bedId || bedWard.bedWards.get(bedId)?.wardId !== wardId) continue;
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
  }, [inpatients.data, bedWard.bedWards, wardId]);

  return {
    rows,
    isLoading: inpatients.isLoading || bedWard.isLoading,
    error: inpatients.error ?? bedWard.error,
    truncated: inpatients.data?.truncated ?? false,
  };
}
