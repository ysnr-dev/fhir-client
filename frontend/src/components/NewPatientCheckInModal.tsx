import { useState } from "react";
import {
  useCreatePatient,
  useSelfDepartments,
  useLocationOptions,
  usePractitionerOptions,
  useWalkInCheckIn,
} from "../api/queries";
import { buildWalkInAppointment } from "../fhir/appointmentHelpers";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import {
  emptyPatientForm,
  buildPatient,
  validateNewPatientForm,
  type PatientFormValues,
} from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { NewPatientFields } from "./NewPatientFields";
import {
  ReceptionFields,
  emptyReceptionSelects,
  type ReceptionSelects,
} from "./ReceptionFields";

// 新患登録。初診で来院した患者を登録し、そのまま当日受付まで済ませる。
//
// 患者の登録(Patient)と受付(枠を持たない予約)は別のリソースなので、登録が
// 通ってから、返ってきた患者で受付を作る二段階で書く。患者だけ登録されて受付に
// 失敗した場合は、患者は残したままエラーを出す(同じ患者を作り直させない)。
// 受付内容の作りは当日受付(WalkInCheckInModal)と同じ。
//
// 入力欄は患者登録・編集フォーム(PatientForm)と同じ患者属性を、受付の最中に
// 書ける並びにしたもの。属性・住所・連絡先の区分けと枠もあちらに合わせ、
// 受付内容を最後の区分けとして並べる。有効(active)は出さない(新規は必ず有効)。

interface NewPatientCheckInModalProps {
  onClose: () => void;
}

export function NewPatientCheckInModal({ onClose }: NewPatientCheckInModalProps) {
  const [values, setValues] = useState<PatientFormValues>(emptyPatientForm);
  // 新患は初診なので、初再診は初診から始める。
  const [selects, setSelects] = useState<ReceptionSelects>({
    ...emptyReceptionSelects,
    visitKind: "first",
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  const departments = useSelfDepartments();
  const practitioners = usePractitionerOptions();
  const locations = useLocationOptions();
  const createPatient = useCreatePatient();
  const checkIn = useWalkInCheckIn();

  const submitting = createPatient.isPending || checkIn.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const error = validateNewPatientForm(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    createPatient.mutate(buildPatient(values), {
      onSuccess: (result) => {
        const department = departments.departments.find((d) => d.id === selects.departmentId);
        const practitioner = practitioners.practitioners.find(
          (p) => p.id === selects.practitionerId,
        );
        const location = locations.locations.find((l) => l.id === selects.locationId);

        const appointment = buildWalkInAppointment(
          result.data,
          {
            departmentCode: department ? departmentCode(department) : "",
            departmentName: department ? departmentDisplayName(department) : "",
            practitionerId: selects.practitionerId,
            practitionerName: practitioner ? practitionerDisplayName(practitioner) : "",
            locationId: selects.locationId,
            locationName: location?.name ?? "",
            visitKind: selects.visitKind,
          },
          new Date(),
        );
        checkIn.mutate(appointment, { onSuccess: onClose });
      },
    });
  }

  return (
    <Modal title="新患登録" onClose={onClose}>
      <ErrorBanner error={departments.error ?? practitioners.error ?? locations.error} />
      <ErrorBanner error={createPatient.error ?? checkIn.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <form className="patient-fields" onSubmit={handleSubmit}>
        <NewPatientFields values={values} setValues={setValues} />

        <fieldset className="patient-fields__group-box">
          <legend>受付情報</legend>

          <ReceptionFields
            className="patient-fields__row"
            values={selects}
            onChange={setSelects}
          />
        </fieldset>

        <div className="walk-in__actions patient-fields__actions">
          <button type="submit" disabled={submitting}>
            {submitting ? "登録中..." : "登録して受付"}
          </button>
          <button type="button" onClick={onClose} disabled={submitting}>
            キャンセル
          </button>
        </div>
      </form>
    </Modal>
  );
}
