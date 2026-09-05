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
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { NameKanjiInput } from "./NameKanjiInput";
import { PostalCodeInput } from "./PostalCodeInput";
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
// 入力欄は患者登録画面(PatientForm)と同じ患者属性を、受付の最中に書ける並びにした
// もの。有効(active)は出さない(新規は必ず有効)。

interface NewPatientCheckInModalProps {
  onClose: () => void;
}

export function NewPatientCheckInModal({ onClose }: NewPatientCheckInModalProps) {
  const [values, setValues] = useState<PatientFormValues>(emptyPatientForm);
  const [selects, setSelects] = useState<ReceptionSelects>(emptyReceptionSelects);
  const [validationError, setValidationError] = useState<string | null>(null);

  const departments = useSelfDepartments();
  const practitioners = usePractitionerOptions();
  const locations = useLocationOptions();
  const createPatient = useCreatePatient();
  const checkIn = useWalkInCheckIn();

  const update = makeFieldUpdater(setValues);
  const submitting = createPatient.isPending || checkIn.isPending;

  // 郵便番号から引けた住所。番地方書は町域に続けて手入力するので、
  // 既に何か書かれていれば触らない。
  function applyPostalAddress(address: { prefecture: string; city: string; town: string }) {
    setValues((current) => ({
      ...current,
      prefecture: address.prefecture,
      city: address.city,
      addressLine: current.addressLine || address.town,
    }));
  }

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
        <div className="patient-fields__row">
          <label className="patient-fields__field--number">
            患者番号
            <input
              type="text"
              value={values.identifierValue}
              onChange={(e) => update("identifierValue", e.target.value)}
              placeholder="空欄なら自動採番"
            />
          </label>
        </div>

        <div className="patient-fields__row">
          <span className="patient-fields__group">患者氏名</span>
          <label>
            <span>
              姓
              <span className="patient-fields__required">必須</span>
            </span>
            <NameKanjiInput
              value={values.familyKanji}
              onChange={(v) => update("familyKanji", v)}
              kana={values.familyKana}
              onKanaChange={(v) => update("familyKana", v)}
            />
          </label>
          <label>
            <span>
              名
              <span className="patient-fields__required">必須</span>
            </span>
            <NameKanjiInput
              value={values.givenKanji}
              onChange={(v) => update("givenKanji", v)}
              kana={values.givenKana}
              onKanaChange={(v) => update("givenKana", v)}
            />
          </label>
        </div>

        <div className="patient-fields__row">
          <span className="patient-fields__group">カナ氏名</span>
          <label>
            <span>
              セイ
              <span className="patient-fields__required">必須</span>
            </span>
            <input
              type="text"
              value={values.familyKana}
              onChange={(e) => update("familyKana", e.target.value)}
            />
          </label>
          <label>
            <span>
              メイ
              <span className="patient-fields__required">必須</span>
            </span>
            <input
              type="text"
              value={values.givenKana}
              onChange={(e) => update("givenKana", e.target.value)}
            />
          </label>
        </div>

        <div className="patient-fields__row">
          <label className="patient-fields__field--gender">
            <span>
              性別
              <span className="patient-fields__required">必須</span>
            </span>
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
            <span>
              生年月日
              <span className="patient-fields__required">必須</span>
            </span>
            <input
              type="date"
              value={values.birthDate}
              onChange={(e) => update("birthDate", e.target.value)}
            />
          </label>
        </div>

        <span className="patient-fields__group">住所</span>
        <div className="patient-fields__row patient-fields__row--indent">
          <label>
            郵便番号
            <PostalCodeInput
              value={values.postalCode}
              onChange={(v) => update("postalCode", v)}
              onResolved={applyPostalAddress}
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
        <div className="patient-fields__row patient-fields__row--indent">
          <label className="patient-fields__field--wide">
            番地方書
            <input
              type="text"
              value={values.addressLine}
              onChange={(e) => update("addressLine", e.target.value)}
            />
          </label>
        </div>

        <span className="patient-fields__group">電話番号</span>
        <div className="patient-fields__row patient-fields__row--indent">
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

        <div className="patient-fields__row">
          <label className="patient-fields__field--email">
            EMail
            <input
              type="email"
              value={values.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </label>
        </div>

        {/* ここから受付内容。患者情報と続けて読ませたくないので見出しで分ける。 */}
        <h3 className="patient-fields__section">受付情報</h3>
        <ReceptionFields
          className="patient-fields__row"
          values={selects}
          onChange={setSelects}
        />

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
