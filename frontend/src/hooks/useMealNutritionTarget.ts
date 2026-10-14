import { useMemo } from "react";
import { useBodyMeasures, usePatient } from "../api/queries";
import { summarizeBodyMeasures } from "../fhir/bodyMeasureHelpers";
import { mealNutritionTarget } from "../fhir/mealNutritionTarget";
import { calculateAge } from "../fhir/patientHelpers";

/** 食事オーダーで食種と並べる、患者の身長・体重と栄養量の目安。patientId が無ければ引かない。 */
export function useMealNutritionTarget(patientId: string | undefined) {
  const bodyMeasures = useBodyMeasures(patientId);
  const patient = usePatient(patientId).data?.data;

  const body = useMemo(
    () => summarizeBodyMeasures(bodyMeasures.observations),
    [bodyMeasures.observations],
  );
  const age = patient?.birthDate ? calculateAge(patient.birthDate) : undefined;
  const target = useMemo(() => mealNutritionTarget(body, age), [body, age]);

  return { body, target, error: bodyMeasures.error, enabled: Boolean(patientId) };
}
