import { useMemo } from "react";
import type { PatientCaution } from "../api/masterClient";
import { usePatientCautions } from "../api/masterQueries";
import {
  useAllergiesForPatients,
  useFlagsForPatients,
  useInfectionsForPatients,
} from "../api/queries";

export type RowPictogramSources = {
  flags: Map<string, fhir4.Flag[]>;
  allergies: Map<string, fhir4.AllergyIntolerance[]>;
  infections: ReturnType<typeof useInfectionsForPatients>["byPatient"];
  cautionsByCode: Map<string, PatientCaution>;
};

/**
 * 一覧の行に注意のピクトグラム(`RowPictograms`)を出すための材料。一覧に並ぶ患者ぶんを
 * まとめて引く(行ごとに引かない)。戻り値はそのまま `RowPictograms` に展開して渡す。
 */
export function useRowPictogramSources(patientIds: string[]): RowPictogramSources {
  const cautions = usePatientCautions();
  const cautionsByCode = useMemo(
    () => new Map<string, PatientCaution>((cautions.data?.items ?? []).map((c) => [c.code, c])),
    [cautions.data],
  );
  const flags = useFlagsForPatients(patientIds);
  const allergies = useAllergiesForPatients(patientIds);
  const infections = useInfectionsForPatients(patientIds);

  return {
    flags: flags.byPatient,
    allergies: allergies.byPatient,
    infections: infections.byPatient,
    cautionsByCode,
  };
}
