import { useState, type ReactNode } from "react";
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
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { resolveBedSelection, type BedRoomIds } from "../fhir/wardHelpers";
import { today } from "../lib/dates";
import { makeFieldUpdater } from "../lib/form";
import { BedRoomSelects } from "./BedRoomSelects";
import { ErrorBanner } from "./ErrorBanner";
import { NursePicker } from "./NursePicker";

// 入院予定の入力。入院患者一覧のモーダル(PlannedAdmissionModal)とカルテ右ペインの
// パネル(PlannedAdmissionCreatePanel)で共用する。患者は親が決めて渡す。
//
// 病棟だけ必須で、病室・ベッドはまだ決めなくてよい。入院予定日も「日付未定」に
// できる(検査待ち・ベッド待ちなど)。未定のまま入院実施できる。

export function PlannedAdmissionForm({
  patient,
  defaultWardId,
  header,
  onSaved,
  onCancel,
}: {
  patient: fhir4.Patient;
  /** 病棟の既定値。一覧で見ている病棟を渡す。 */
  defaultWardId?: string;
  /** 入力欄の上に出す行(モーダルでは選んだ患者)。送信中は操作させない。 */
  header?: (submitting: boolean) => ReactNode;
  onSaved: () => void;
  /** キャンセル。右ペインは見出しに「閉じる」があるので渡さない。 */
  onCancel?: () => void;
}) {
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
  // 日付未定。日付欄の値は消さずに置いておき、外したときに戻せるようにする。
  const [undated, setUndated] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const wardOptions = useWardOptions();
  const grid = useWardGrid(place.wardId || undefined);
  const departments = useSelfDepartments();
  const practitioners = usePractitionerOptions();
  const register = useAdmitPatient();

  const update = makeFieldUpdater(setValues);

  function handleSubmit() {
    if (!patient.id) return;

    const selection = resolveBedSelection(wardOptions.wards, grid, place);
    const merged: PlannedAdmissionFormValues = {
      ...values,
      wardId: selection.wardId,
      roomId: selection.roomId,
      bedId: selection.bedId,
      plannedDate: undated ? "" : values.plannedDate,
    };
    const error =
      validatePlannedAdmissionForm(merged) ??
      (!undated && !values.plannedDate ? "入院予定日を入力するか、日付未定にしてください。" : null);
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
    register.mutate(encounter, { onSuccess: onSaved });
  }

  return (
    <div className="walk-in">
      <ErrorBanner
        error={wardOptions.error ?? grid.error ?? departments.error ?? practitioners.error}
      />
      <ErrorBanner error={register.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      {header?.(register.isPending)}

      <div className="walk-in__fields">
        <BedRoomSelects wards={wardOptions.wards} grid={grid} value={place} onChange={setPlace} />
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
          入院予定日
          <input
            type="date"
            value={values.plannedDate}
            disabled={undated}
            onChange={(e) => update("plannedDate", e.target.value)}
          />
        </label>
        <label className="admission__undated">
          <input
            type="checkbox"
            checked={undated}
            onChange={(e) => setUndated(e.target.checked)}
          />
          日付未定
        </label>
        <label className="admission__note">
          特記事項
          <textarea rows={2} value={values.note} onChange={(e) => update("note", e.target.value)} />
        </label>
      </div>

      <div className="walk-in__actions">
        <button type="button" onClick={handleSubmit} disabled={register.isPending}>
          {register.isPending ? "登録中..." : "入院予定を登録"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={register.isPending}>
            キャンセル
          </button>
        )}
      </div>
    </div>
  );
}
