import { useMemo } from "react";
import { useContrastMedicines, usePatientCautions } from "../api/masterQueries";
import {
  useActiveAllergies,
  useActiveFlags,
  useActiveMedications,
  usePatient,
  useRecentLabResults,
} from "../api/queries";
import { summarizeRenal } from "../fhir/bodyMeasureHelpers";
import { summarizeFlag } from "../fhir/flagHelpers";
import { calculateAge } from "../fhir/patientHelpers";
import {
  buildRadSafetyNotes,
  contrastAllergenCodes,
  isContrastExam,
  matchContrastAllergies,
  type RadSafetyItem,
} from "../fhir/radSafetyHelpers";
import { today } from "../lib/dates";

/**
 * 造影検査・MRI の注意(docs/rad-backlog.md B-1 / B-2)。選んだ撮影項目に造影・MRI が
 * 含まれるときだけ、カルテの記録から拾った注意を出す。該当が無ければ何も出さない。
 */
export function RadSafetyNotice({
  patientId,
  items,
}: {
  patientId: string;
  items: RadSafetyItem[];
}) {
  const contrast = items.some(isContrastExam);
  const flags = useActiveFlags(patientId);
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
  if (contrast && (labResults.isPending || !patient)) {
    return null;
  }
  if (notes.length === 0) return null;

  return (
    <ul className="rad-safety-notice" role="note">
      {notes.map((note) => (
        <li key={note.key} className={note.high ? "rad-safety-notice__high" : undefined}>
          {note.text}
        </li>
      ))}
    </ul>
  );
}
