import { usePatient, usePatientAdmission } from "../api/queries";
import { calculateAge, displayKana, displayName, genderLabel } from "../fhir/patientHelpers";

interface PatientHeaderProps {
  patientId: string | undefined;
}

export function PatientHeader({ patientId }: PatientHeaderProps) {
  const patient = usePatient(patientId);
  // 入院中なら居場所を添える(外来のときは項目ごと出さない)。
  const admission = usePatientAdmission(patientId);
  const p = patient.data?.data;
  if (!p) return null;

  // 「東3階病棟 301号室」。どの床かまでは出さない。
  const admissionPlace = admission.data
    ? [admission.data.wardName, admission.data.roomName].filter(Boolean).join(" ")
    : "";

  const kana = displayKana(p);
  const age = p.birthDate ? calculateAge(p.birthDate) : undefined;
  const birth = p.birthDate ? `${p.birthDate}${age !== undefined ? `（${age}歳）` : ""}` : "-";

  return (
    <div className="patient-header">
      <span className="patient-header__item">
        <span className="patient-header__label">患者番号</span>
        <span className="patient-header__value">{p.identifier?.[0]?.value ?? "-"}</span>
      </span>
      <span className="patient-header__item">
        <span className="patient-header__label">氏名</span>
        <span className="patient-header__value patient-header__value--name">{displayName(p)}</span>
      </span>
      {kana && (
        <span className="patient-header__item">
          <span className="patient-header__label">カナ</span>
          <span className="patient-header__value">{kana}</span>
        </span>
      )}
      <span className="patient-header__item">
        <span className="patient-header__label">生年月日</span>
        <span className="patient-header__value">{birth}</span>
      </span>
      <span className="patient-header__item">
        <span className="patient-header__label">性別</span>
        <span className="patient-header__value">{genderLabel(p.gender)}</span>
      </span>
      {admissionPlace && (
        <span className="patient-header__item">
          <span className="patient-header__label">入院</span>
          <span className="patient-header__value">{admissionPlace}</span>
        </span>
      )}
    </div>
  );
}
