import { useMemo } from "react";
import { useContrastMedicines, usePatientCautions } from "../api/masterQueries";
import {
  useActiveAllergies,
  useActiveFlags,
  useActiveMedications,
  usePatient,
  useRecentLabResults,
} from "../api/queries";
import type { Advisory } from "../fhir/advisoryHelpers";
import { summarizeRenal } from "../fhir/bodyMeasureHelpers";
import { summarizeFlag } from "../fhir/flagHelpers";
import { calculateAge } from "../fhir/patientHelpers";
import {
  buildRadSafetyNotes,
  contrastAllergenCodes,
  isContrastExam,
  matchContrastAllergies,
  radSafetyAdvisories,
  type RadSafetyItem,
} from "../fhir/radSafetyHelpers";
import { today } from "../lib/dates";

const NONE: Advisory[] = [];

/**
 * 造影検査・MRI の注意(docs/rad-backlog.md B-1 / B-2)。選んだ撮影項目に造影・MRI が
 * 含まれるときだけ、カルテの記録から拾った注意を共通の警告で返す。該当が無ければ空。
 * 患者が決まらない画面では patientId を空で呼ぶ。
 */
export function useRadSafetyAdvisories(patientId: string, items: RadSafetyItem[]): Advisory[] {
  const contrast = items.some(isContrastExam);
  const flags = useActiveFlags(patientId || undefined);
  const cautions = usePatientCautions();
  const { allergies } = useActiveAllergies(contrast ? patientId : undefined);
  const contrastMedicines = useContrastMedicines(contrast);
  const { medications } = useActiveMedications(contrast ? patientId : undefined, today());
  const patient = usePatient(contrast ? patientId : undefined).data?.data;
  const labResults = useRecentLabResults(contrast ? patientId : undefined);

  const notes = useMemo(() => {
    const byCode = new Map((cautions.data?.items ?? []).map((c) => [c.code, c]));
    const age = patient?.birthDate ? calculateAge(patient.birthDate) : undefined;
    return buildRadSafetyNotes({
      items,
      flags: flags.flags.map((flag) => summarizeFlag(flag, byCode)),
      contrastAllergies: matchContrastAllergies(
        allergies,
        contrastAllergenCodes(contrastMedicines.data ?? []),
      ),
      renal: summarizeRenal(labResults.observations, { age, gender: patient?.gender }),
      medications,
    });
  }, [items, flags.flags, cautions.data, allergies, contrastMedicines.data, patient, labResults.observations, medications]);

  // 読み込み中に「クレアチニンの結果がありません」と出さない。
  return useMemo(() => {
    if (!patientId || (contrast && (labResults.isPending || !patient))) return NONE;
    return radSafetyAdvisories(notes);
  }, [patientId, contrast, labResults.isPending, patient, notes]);
}
