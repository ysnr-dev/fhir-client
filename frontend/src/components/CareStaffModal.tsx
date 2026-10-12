import { useState } from "react";
import { useDoctorOptions, useNurseOptions, useUpdateEncounter } from "../api/queries";
import {
  buildCareStaffEncounter,
  encounterAttendingId,
  encounterAttendingName,
  nurseParticipants,
} from "../fhir/encounterHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { referenceId } from "../fhir/shared";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { NursePicker } from "./NursePicker";

// 担当者変更。入院(Encounter)の主治医と担当看護師を差し替える。主治医の選択肢は医師・
// 歯科医師、担当看護師の選択肢は看護職に絞る。

/**
 * 職種の選択肢に、いま担当に入っているのに選択肢に無い人(職種の違う人・無効化された職員)を
 * 入院に記録された表示名で足す。開いただけで担当から外れないようにするため。
 */
function withCurrentStaff(
  options: fhir4.Practitioner[],
  current: { id: string; name: string }[],
): fhir4.Practitioner[] {
  const missing = current
    .filter((staff) => !options.some((p) => p.id === staff.id))
    .map((staff): fhir4.Practitioner => ({
      resourceType: "Practitioner",
      id: staff.id,
      name: [{ family: staff.name }],
    }));
  return [...missing, ...options];
}

export function CareStaffModal({
  encounter,
  patient,
  onClose,
}: {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  onClose: () => void;
}) {
  const currentAttendingId = encounterAttendingId(encounter);
  const currentNurses = nurseParticipants(encounter).flatMap((p) => {
    const id = referenceId(p.individual?.reference);
    return id ? [{ id, name: p.individual?.display ?? id }] : [];
  });
  const [practitionerId, setPractitionerId] = useState(currentAttendingId ?? "");
  const [nurseIds, setNurseIds] = useState(currentNurses.map((nurse) => nurse.id));
  const doctorOptions = useDoctorOptions();
  const nurseOptions = useNurseOptions();
  const save = useUpdateEncounter();

  const doctors = withCurrentStaff(
    doctorOptions.doctors,
    currentAttendingId ? [{ id: currentAttendingId, name: encounterAttendingName(encounter) }] : [],
  );
  const nurses = withCurrentStaff(nurseOptions.nurses, currentNurses);

  function nameOf(list: fhir4.Practitioner[], id: string): string {
    const found = list.find((p) => p.id === id);
    return found ? practitionerDisplayName(found) : id;
  }

  function handleSubmit() {
    save.mutate(
      buildCareStaffEncounter(encounter, {
        attending: practitionerId ? { id: practitionerId, name: nameOf(doctors, practitionerId) } : null,
        nurses: nurseIds.map((id) => ({ id, name: nameOf(nurses, id) })),
      }),
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="担当者変更" onClose={onClose}>
      <ErrorBanner error={save.error ?? doctorOptions.error ?? nurseOptions.error} />

      <div className="walk-in">
        <div className="walk-in__patient">
          <span>{patient ? displayName(patient) : "(患者不明)"}</span>
        </div>

        <div className="walk-in__fields">
          <label>
            主治医
            <select value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
              <option value="">未指定</option>
              {doctors.map((practitioner) => (
                <option key={practitioner.id} value={practitioner.id}>
                  {practitionerDisplayName(practitioner)}
                </option>
              ))}
            </select>
          </label>
          <NursePicker practitioners={nurses} nurseIds={nurseIds} onChange={setNurseIds} />
        </div>

        <div className="walk-in__actions">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={save.isPending || doctorOptions.isLoading || nurseOptions.isLoading}
          >
            {save.isPending ? "登録中..." : "変更"}
          </button>
          <button type="button" onClick={onClose} disabled={save.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
