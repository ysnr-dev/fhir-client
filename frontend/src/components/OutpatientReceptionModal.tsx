import { useMemo, useState } from "react";
import {
  useLocationOptions,
  usePractitionerOptions,
  useSelfDepartments,
  useUpdateOutpatientReception,
  type OutpatientRow,
} from "../api/queries";
import {
  appointmentActorId,
  appointmentDepartmentCode,
  withReceptionAssignment,
  type ReceptionAssignment,
} from "../fhir/appointmentHelpers";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import { withExamAssignment } from "../fhir/outpatientEncounterHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import {
  ReceptionFields,
  type ReceptionSelects,
} from "./ReceptionFields";

// 受付内容(診療科・担当医・診察室)の変更。外来一覧の行のケバブメニューから開く。
//
// 予約は枠から診療科・担当医・診察室を引き継ぐが、当日になって担当医が替わる・
// 別の診察室に回すといったことが起きる。入力欄は当日受付と同じものを使う。

export function OutpatientReceptionModal({
  row,
  onClose,
}: {
  row: OutpatientRow;
  onClose: () => void;
}) {
  const departments = useSelfDepartments();
  const practitioners = usePractitionerOptions();
  const locations = useLocationOptions();
  const save = useUpdateOutpatientReception();

  // 初期値は今の予約の内容。診療科は SS-MIX2 コードでしか持っていないので、
  // コードから自院の科を引き当てる(引き当たらない科は未指定から選び直す)。
  const initial = useMemo<ReceptionSelects>(() => {
    const code = appointmentDepartmentCode(row.appointment);
    return {
      departmentId:
        (code ? departments.departments.find((d) => departmentCode(d) === code)?.id : "") ?? "",
      practitionerId: appointmentActorId(row.appointment, "Practitioner"),
      locationId: appointmentActorId(row.appointment, "Location"),
    };
  }, [departments.departments, row.appointment]);

  // 触るまでは初期値をそのまま出す(診療科の一覧は後から届くので、state に
  // 初期値を写し取らずに毎回引き当てる)。
  const [edited, setEdited] = useState<ReceptionSelects | null>(null);
  const values = edited ?? initial;

  function handleSubmit() {
    const department = departments.departments.find((d) => d.id === values.departmentId);
    const practitioner = practitioners.practitioners.find((p) => p.id === values.practitionerId);
    const location = locations.locations.find((l) => l.id === values.locationId);
    const assignment: ReceptionAssignment = {
      departmentCode: department ? departmentCode(department) : "",
      departmentName: department ? departmentDisplayName(department) : "",
      practitionerId: values.practitionerId,
      practitionerName: practitioner ? practitionerDisplayName(practitioner) : "",
      locationId: values.locationId,
      locationName: location?.name ?? "",
    };

    save.mutate(
      {
        appointment: withReceptionAssignment(row.appointment, assignment),
        // 診察が始まっていれば、診察の担当医・診察室も一緒に合わせる。
        encounter: row.encounter ? withExamAssignment(row.encounter, assignment) : undefined,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="診療科・担当医・診察室の変更" onClose={onClose} className="modal--wide">
      <ErrorBanner error={departments.error ?? practitioners.error ?? locations.error} />
      <ErrorBanner error={save.error} />

      <div className="walk-in">
        <div className="walk-in__patient">
          <span>{row.patient?.identifier?.[0]?.value ?? "-"}</span>
          <span>{row.patient ? displayName(row.patient) : "(患者不明)"}</span>
        </div>

        <ReceptionFields className="walk-in__fields" values={values} onChange={setEdited} />

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={save.isPending}>
            {save.isPending ? "変更中..." : "変更"}
          </button>
          <button type="button" onClick={onClose} disabled={save.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
