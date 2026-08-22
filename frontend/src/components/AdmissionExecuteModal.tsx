import { useState } from "react";
import {
  usePractitionerOptions,
  useSelfDepartments,
  useUpdateEncounter,
  useWardGrid,
  useWardOptions,
} from "../api/queries";
import { departmentDisplayName } from "../fhir/departmentHelpers";
import {
  buildAdmissionFromPlan,
  encounterAttendingId,
  encounterDepartmentId,
  encounterNote,
  encounterNurseIds,
  plannedBedId,
  plannedRoomId,
  plannedWardId,
  validateAdmissionForm,
  type AdmissionFormValues,
} from "../fhir/encounterHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { bedDisplayName, resolveBedSelection, type BedRoomIds } from "../fhir/wardHelpers";
import { today } from "../lib/dates";
import { makeFieldUpdater } from "../lib/form";
import { BedRoomSelects } from "./BedRoomSelects";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { NursePicker } from "./NursePicker";

// 入院実施。入院予定(status=planned)を、入院登録と同じ項目を確かめながら
// in-progress に書き換える。予定の内容を初期値にするが、ベッドは実施時点で
// 空いている床から選び直す(予定していた床が埋まっていることがある)。

export function AdmissionExecuteModal({
  plan,
  patient,
  occupiedBedIds,
  admittedBedLabelByPatientId,
  onClose,
}: {
  plan: fhir4.Encounter;
  patient?: fhir4.Patient;
  /** いま入院中の患者が居るベッドの id。空床のみ選ばせるのに使う。 */
  occupiedBedIds: Set<string>;
  /** 患者 id -> 既に入院しているベッドの表示名。二重入院の警告に使う。 */
  admittedBedLabelByPatientId: Map<string, string>;
  onClose: () => void;
}) {
  const [place, setPlace] = useState<BedRoomIds>({
    wardId: plannedWardId(plan) ?? "",
    roomId: plannedRoomId(plan) ?? "",
    bedId: plannedBedId(plan) ?? "",
  });
  const [values, setValues] = useState<AdmissionFormValues>({
    departmentId: encounterDepartmentId(plan) ?? "",
    practitionerId: encounterAttendingId(plan) ?? "",
    nurseIds: encounterNurseIds(plan),
    // 予定日ではなく今日を既定にする。実施はその日のうちに登録するのが普通なので。
    admissionDate: today(),
    note: encounterNote(plan),
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  const wardOptions = useWardOptions();
  const grid = useWardGrid(place.wardId || undefined);
  const departments = useSelfDepartments();
  const practitioners = usePractitionerOptions();
  const execute = useUpdateEncounter();

  const update = makeFieldUpdater(setValues);

  function handleSubmit() {
    const selection = resolveBedSelection(wardOptions.wards, grid, place, occupiedBedIds);
    if (!selection.bedId) {
      setValidationError("入院先のベッドを選択してください。");
      return;
    }
    const error = validateAdmissionForm(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    // 転床やデータ修正の途中ということもあるので、止めずに確認だけする。
    const patientId = patient?.id;
    const admittedBed = patientId ? admittedBedLabelByPatientId.get(patientId) : undefined;
    if (admittedBed && patient) {
      if (
        !window.confirm(
          `${displayName(patient)} は既に入院しています(${admittedBed})。このまま入院登録しますか?`,
        )
      ) {
        return;
      }
    }

    const department = departments.departments.find((d) => d.id === values.departmentId);
    const practitioner = practitioners.practitioners.find((p) => p.id === values.practitionerId);
    const nurses = values.nurseIds
      .map((id) => practitioners.practitioners.find((p) => p.id === id))
      .filter((p): p is fhir4.Practitioner => Boolean(p?.id))
      .map((p) => ({ id: p.id as string, name: practitionerDisplayName(p) }));

    const encounter = buildAdmissionFromPlan(
      plan,
      {
        bedId: selection.bedId,
        bedLabel: selection.bed
          ? bedDisplayName(selection.bed, selection.roomName)
          : selection.bedName,
        departmentName: department ? departmentDisplayName(department) : "",
        practitionerName: practitioner ? practitionerDisplayName(practitioner) : "",
        nurses,
      },
      values,
    );
    execute.mutate(encounter, { onSuccess: onClose });
  }

  return (
    <Modal
      title={`入院実施 - ${patient ? displayName(patient) : "(患者不明)"}`}
      onClose={onClose}
      className="modal--wide"
    >
      <ErrorBanner error={wardOptions.error ?? grid.error ?? departments.error ?? practitioners.error} />
      <ErrorBanner error={execute.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__fields">
          <BedRoomSelects
            wards={wardOptions.wards}
            grid={grid}
            value={place}
            onChange={setPlace}
            roomLabel="病室(必須)"
            bedLabel="ベッド(必須)"
            occupiedBedIds={occupiedBedIds}
          />
          <label>
            診療科(必須)
            <select
              value={values.departmentId}
              onChange={(e) => update("departmentId", e.target.value)}
            >
              <option value="">未指定</option>
              {departments.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {departmentDisplayName(department)}
                </option>
              ))}
            </select>
          </label>
          <label>
            主治医
            <select
              value={values.practitionerId}
              onChange={(e) => update("practitionerId", e.target.value)}
            >
              <option value="">未指定</option>
              {practitioners.practitioners.map((practitioner) => (
                <option key={practitioner.id} value={practitioner.id}>
                  {practitionerDisplayName(practitioner)}
                </option>
              ))}
            </select>
          </label>
          <NursePicker
            practitioners={practitioners.practitioners}
            nurseIds={values.nurseIds}
            onChange={(nurseIds) => update("nurseIds", nurseIds)}
          />
          <label>
            入院日(必須)
            <input
              type="date"
              value={values.admissionDate}
              onChange={(e) => update("admissionDate", e.target.value)}
            />
          </label>
          <label className="admission__note">
            特記事項
            <textarea
              rows={2}
              value={values.note}
              onChange={(e) => update("note", e.target.value)}
            />
          </label>
        </div>

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={execute.isPending}>
            {execute.isPending ? "登録中..." : "入院登録"}
          </button>
          <button type="button" onClick={onClose} disabled={execute.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
