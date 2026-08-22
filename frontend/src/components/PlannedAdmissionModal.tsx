import { useState } from "react";
import {
  useAdmitPatient,
  usePractitionerOptions,
  useSelfDepartments,
  useWardGrid,
  useWardOptions,
} from "../api/queries";
import { departmentDisplayName } from "../fhir/departmentHelpers";
import {
  buildPlannedAdmissionEncounter,
  validatePlannedAdmissionForm,
  type PlannedAdmissionFormValues,
} from "../fhir/encounterHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { today } from "../lib/dates";
import { makeFieldUpdater } from "../lib/form";
import { AdmissionPatientSearch } from "./AdmissionModal";
import { resolveBedSelection, type BedRoomIds } from "../fhir/wardHelpers";
import { BedRoomSelects } from "./BedRoomSelects";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { NursePicker } from "./NursePicker";

// 入院予定の新規登録。入院登録(AdmissionModal)と同じ二段構えだが、こちらは
// 行(ベッド)からではなく一覧のボタンから開くので、病棟・病室・ベッドも選ぶ。
// 病棟と入院予定日だけ必須で、病室・ベッドはまだ決めなくてよい。

export function PlannedAdmissionModal({
  defaultWardId,
  onClose,
}: {
  /** 病棟の既定値。一覧で見ている病棟を渡す。 */
  defaultWardId?: string;
  onClose: () => void;
}) {
  const [patient, setPatient] = useState<fhir4.Patient | null>(null);
  const [place, setPlace] = useState<BedRoomIds>({
    wardId: defaultWardId ?? "",
    roomId: "",
    bedId: "",
  });
  const [values, setValues] = useState<PlannedAdmissionFormValues>({
    wardId: "",
    roomId: "",
    bedId: "",
    departmentId: "",
    practitionerId: "",
    nurseIds: [],
    plannedDate: today(),
    note: "",
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  const wardOptions = useWardOptions();
  const grid = useWardGrid(place.wardId || undefined);
  const departments = useSelfDepartments();
  const practitioners = usePractitionerOptions();
  const register = useAdmitPatient();

  const update = makeFieldUpdater(setValues);

  function handleSubmit() {
    if (!patient?.id) return;

    const selection = resolveBedSelection(wardOptions.wards, grid, place);
    const merged: PlannedAdmissionFormValues = {
      ...values,
      wardId: selection.wardId,
      roomId: selection.roomId,
      bedId: selection.bedId,
    };
    const error = validatePlannedAdmissionForm(merged);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    const department = departments.departments.find((d) => d.id === values.departmentId);
    const practitioner = practitioners.practitioners.find((p) => p.id === values.practitionerId);
    const nurses = values.nurseIds
      .map((id) => practitioners.practitioners.find((p) => p.id === id))
      .filter((p): p is fhir4.Practitioner => Boolean(p?.id))
      .map((p) => ({ id: p.id as string, name: practitionerDisplayName(p) }));

    const encounter = buildPlannedAdmissionEncounter(
      patient,
      {
        wardName: selection.wardName,
        roomName: selection.roomName,
        bedName: selection.bedName,
        departmentName: department ? departmentDisplayName(department) : "",
        practitionerName: practitioner ? practitionerDisplayName(practitioner) : "",
        nurses,
      },
      merged,
    );
    register.mutate(encounter, { onSuccess: onClose });
  }

  return (
    <Modal title="入院予定の登録" onClose={onClose} className="modal--wide">
      <ErrorBanner error={wardOptions.error ?? grid.error ?? departments.error ?? practitioners.error} />
      <ErrorBanner error={register.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      {patient ? (
        <div className="walk-in">
          <div className="walk-in__patient">
            <span>{patient.identifier?.[0]?.value ?? "-"}</span>
            <span>{displayName(patient)}</span>
            <button type="button" onClick={() => setPatient(null)} disabled={register.isPending}>
              選び直す
            </button>
          </div>

          <div className="walk-in__fields">
            <BedRoomSelects
              wards={wardOptions.wards}
              grid={grid}
              value={place}
              onChange={setPlace}
            />
            <label>
              診療科
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
              入院予定日(必須)
              <input
                type="date"
                value={values.plannedDate}
                onChange={(e) => update("plannedDate", e.target.value)}
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
            <button type="button" onClick={handleSubmit} disabled={register.isPending}>
              {register.isPending ? "登録中..." : "入院予定を登録"}
            </button>
            <button type="button" onClick={onClose} disabled={register.isPending}>
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <AdmissionPatientSearch onSelect={setPatient} />
      )}
    </Modal>
  );
}
