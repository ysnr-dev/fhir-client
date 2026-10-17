import { useMemo } from "react";
import type { PatientCaution } from "../api/masterClient";
import { usePatientCautions } from "../api/masterQueries";
import { useAllergiesForPatients, useFlagsForPatients, useInfectionsForPatients } from "../api/queries";
import type { RowPictograms } from "../components/PatientListRowParts";

export type Pictograms = Omit<Parameters<typeof RowPictograms>[0], "patientId">;

/** 一覧の患者ぶんの注意ピクトグラム(注意区分・アレルギー・感染症)をまとめて 1 回ずつ引く。 */
export function useRowPictograms(patientIds: string[]): Pictograms {
  const cautions = usePatientCautions();
  const cautionsByCode = useMemo(
    () => new Map<string, PatientCaution>((cautions.data?.items ?? []).map((c) => [c.code, c])),
    [cautions.data],
  );
  const flags = useFlagsForPatients(patientIds);
  const allergies = useAllergiesForPatients(patientIds);
  const infections = useInfectionsForPatients(patientIds);
  return { flags: flags.byPatient, allergies: allergies.byPatient, infections: infections.byPatient, cautionsByCode };
}
