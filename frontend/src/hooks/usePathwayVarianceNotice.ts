import { useMemo } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { usePathwayVarianceTasks, usePatientAdmission } from "../api/queries";
import { encounterAttendingId, encounterAttendingName } from "../fhir/encounterHelpers";
import type { PathwayApplicationRecord, PathwayEventRecord } from "../fhir/pathwayApplyHelpers";
import { eventDayStepLabel } from "../fhir/pathwayHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { varianceTasksByUnitId, type PathwayVarianceNotice } from "../fhir/pathwayVarianceHelpers";

/**
 * 評価を記録する画面(評価モーダル・日めくり)が、バリアンスの通知を組むための情報を揃える。
 * 宛先は入院の主治医(Encounter の ATND)。パスを当てた入院と今の入院が違う、または入院していないときは
 * 宛先なしで作る(通知の一覧には全員に出る)。
 * ready になるまで記録させない(これまでの通知が読めていないと、同じアウトカムに通知が重なる)。
 */
export function usePathwayVarianceNotice(
  patientId: string,
  application: PathwayApplicationRecord | null | undefined,
) {
  const tasks = usePathwayVarianceTasks(patientId);
  const admission = usePatientAdmission(patientId);
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const tasksByUnitId = useMemo(() => varianceTasksByUnitId(tasks.data ?? []), [tasks.data]);
  const ready = Boolean(tasks.data) && !admission.isPending;

  function noticeFor(event: PathwayEventRecord): PathwayVarianceNotice | null {
    if (!application || !ready) return null;
    const encounter = admission.data?.encounter;
    const sameAdmission = encounter && (!application.encounterId || encounter.id === application.encounterId);
    const attendingId = sameAdmission ? encounterAttendingId(encounter) : undefined;
    return {
      patientId,
      owner:
        attendingId && encounter
          ? { reference: `Practitioner/${attendingId}`, display: encounterAttendingName(encounter) }
          : undefined,
      requester:
        practitionerId && practitioner
          ? { reference: `Practitioner/${practitionerId}`, display: practitionerDisplayName(practitioner) }
          : undefined,
      pathwayTitle: application.title,
      applyId: application.id,
      event: {
        id: event.id,
        label: `病日 ${event.elapsedDays} ${eventDayStepLabel(event.elapsedDays, event.title, event.pathStep, event.pathStepName)}`,
        date: event.date,
      },
      tasksByUnitId,
    };
  }

  return { ready, error: tasks.error ?? admission.error, noticeFor };
}
