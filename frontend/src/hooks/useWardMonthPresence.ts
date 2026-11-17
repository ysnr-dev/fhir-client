import { useMemo } from "react";
import { useBedWardIndex, useEncountersInRange } from "../api/queries";
import { wardPatientsByDay } from "../fhir/bedScheduleHelpers";
import { addDays, addMonths, today } from "../lib/dates";

/**
 * 病棟 × 月の在院(日 → その日に病棟に居た患者 id の集合)。デバイス日数・感染率の分母に使う。
 * days は集計の対象日で、当月は今日までにする(先の日の在院は見込みなので分母にしない)。
 */
export function useWardMonthPresence(month: string, wardId: string) {
  const from = `${month}-01`;
  const to = addDays(addMonths(from, 1), -1);
  const encounters = useEncountersInRange(from, to);
  const bedWards = useBedWardIndex();
  const presence = useMemo(
    () =>
      wardPatientsByDay({
        encounters: encounters.data?.encounters ?? [],
        bedPlaces: bedWards.bedWards,
        wardId,
        from,
        to,
      }),
    [encounters.data, bedWards.bedWards, wardId, from, to],
  );
  const patientIds = useMemo(() => [...new Set([...presence.values()].flatMap((set) => [...set]))], [presence]);
  const todayValue = today();
  const days = useMemo(() => [...presence.keys()].filter((day) => day <= todayValue), [presence, todayValue]);
  return {
    from,
    to,
    presence,
    patientIds,
    days,
    patientsById: encounters.data?.patientsById,
    isLoading: encounters.isLoading || bedWards.isLoading,
    errors: [encounters.error, bedWards.error],
    truncated: Boolean(encounters.data?.truncated),
  };
}
