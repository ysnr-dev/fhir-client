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
import { emptyPatientForm, buildPatient, type PatientFormValues } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { NameKanjiInput } from "./NameKanjiInput";

// 新患登録。初診で来院した患者を登録し、そのまま当日受付まで済ませる。
//
// 患者の登録(Patient)と受付(枠を持たない予約)は別のリソースなので、登録が
// 通ってから、返ってきた患者で受付を作る二段階で書く。患者だけ登録されて受付に
// 失敗した場合は、患者は残したままエラーを出す(同じ患者を作り直させない)。
// 受付内容の作りは当日受付(WalkInCheckInModal)と同じ。
//
// 入力欄は患者登録画面(PatientForm)と同じ患者属性を、受付の最中に書ける並びにした
// もの。有効(active)は出さない(新規は必ず有効)。

interface NewPatientCheckInModalProps {
  onClose: () => void;
}

interface WalkInSelects {
  departmentId: string;
  practitionerId: string;
  locationId: string;
}

const emptySelects: WalkInSelects = { departmentId: "", practitionerId: "", locationId: "" };

export function NewPatientCheckInModal({ onClose }: NewPatientCheckInModalProps) {
  const [values, setValues] = useState<PatientFormValues>(emptyPatientForm);
  const [selects, setSelects] = useState<WalkInSelects>(emptySelects);

  const departments = useSelfDepartments();
  const practitioners = usePractitionerOptions();
  const locations = useLocationOptions();
  const createPatient = useCreatePatient();
  const checkIn = useWalkInCheckIn();

  const update = makeFieldUpdater(setValues);
  const submitting = createPatient.isPending || checkIn.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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

      <form className="new-patient" onSubmit={handleSubmit}>
        <div className="new-patient__row">
          <label className="new-patient__field--number">
            患者番号
            <input
              type="text"
              value={values.identifierValue}
              onChange={(e) => update("identifierValue", e.target.value)}
              placeholder="空欄なら自動採番"
            />
          </label>
        </div>

        <div className="new-patient__row">
          <span className="new-patient__group">患者氏名</span>
          <label>
            姓
            <NameKanjiInput
              value={values.familyKanji}
              onChange={(v) => update("familyKanji", v)}
              kana={values.familyKana}
              onKanaChange={(v) => update("familyKana", v)}
            />
          </label>
          <label>
            名
            <NameKanjiInput
              value={values.givenKanji}
              onChange={(v) => update("givenKanji", v)}
              kana={values.givenKana}
              onKanaChange={(v) => update("givenKana", v)}
            />
          </label>
        </div>

        <div className="new-patient__row">
          <span className="new-patient__group">カナ氏名</span>
          <label>
            セイ
            <input
              type="text"
              value={values.familyKana}
              onChange={(e) => update("familyKana", e.target.value)}
            />
          </label>
          <label>
            メイ
            <input
              type="text"
              value={values.givenKana}
              onChange={(e) => update("givenKana", e.target.value)}
            />
          </label>
        </div>

        <div className="new-patient__row">
          <label className="new-patient__field--gender">
            性別
            <select
              value={values.gender}
              onChange={(e) => update("gender", e.target.value as PatientFormValues["gender"])}
            >
              <option value="">未指定</option>
              <option value="male">男性</option>
              <option value="female">女性</option>
              <option value="other">その他</option>
              <option value="unknown">不明</option>
            </select>
          </label>
          <label>
            生年月日
            <input
              type="date"
              value={values.birthDate}
              onChange={(e) => update("birthDate", e.target.value)}
            />
          </label>
        </div>

        <span className="new-patient__group">住所</span>
        <div className="new-patient__row new-patient__row--indent">
          <label>
            郵便番号
            <input
              type="text"
              value={values.postalCode}
              onChange={(e) => update("postalCode", e.target.value)}
            />
          </label>
          <label>
            都道府県
            <input
              type="text"
              value={values.prefecture}
              onChange={(e) => update("prefecture", e.target.value)}
            />
          </label>
          <label>
            市区町村
            <input
              type="text"
              value={values.city}
              onChange={(e) => update("city", e.target.value)}
            />
          </label>
        </div>
        <div className="new-patient__row new-patient__row--indent">
          <label className="new-patient__field--wide">
            番地方書
            <input
              type="text"
              value={values.addressLine}
              onChange={(e) => update("addressLine", e.target.value)}
            />
          </label>
        </div>

        <span className="new-patient__group">電話番号</span>
        <div className="new-patient__row new-patient__row--indent">
          <label>
            固定電話
            <input
              type="text"
              value={values.homePhone}
              onChange={(e) => update("homePhone", e.target.value)}
            />
          </label>
          <label>
            携帯電話
            <input
              type="text"
              value={values.mobilePhone}
              onChange={(e) => update("mobilePhone", e.target.value)}
            />
          </label>
        </div>

        <div className="new-patient__row">
          <label className="new-patient__field--email">
            EMail
            <input
              type="email"
              value={values.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </label>
        </div>

        {/* ここから受付内容。患者情報と続けて読ませたくないので見出しで分ける。 */}
        <h3 className="new-patient__section">受付情報</h3>
        <div className="new-patient__row">
          <label>
            診療科
            <select
              value={selects.departmentId}
              onChange={(e) => setSelects({ ...selects, departmentId: e.target.value })}
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
            担当医
            <select
              value={selects.practitionerId}
              onChange={(e) => setSelects({ ...selects, practitionerId: e.target.value })}
            >
              <option value="">未指定</option>
              {practitioners.practitioners.map((practitioner) => (
                <option key={practitioner.id} value={practitioner.id}>
                  {practitionerDisplayName(practitioner)}
                </option>
              ))}
            </select>
          </label>
          <label>
            診察室
            <select
              value={selects.locationId}
              onChange={(e) => setSelects({ ...selects, locationId: e.target.value })}
            >
              <option value="">未指定</option>
              {locations.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="walk-in__actions new-patient__actions">
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
