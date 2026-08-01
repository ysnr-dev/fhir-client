// 医療従事者(Practitioner)の組み立て・復元。
// 上流 fhir-server は JP Core の JP_Practitioner プロファイルを想定しており、
// 必須項目は無い(gender / birthDate は値がある場合だけ書式検証される)。
import {
  buildJapaneseNames,
  displayJapaneseKana,
  displayJapaneseName,
  emptyJapaneseName,
  parseJapaneseNames,
  type JapaneseNameParts,
} from "./humanName";
import type { Gender } from "./patientHelpers";

// 医籍登録番号。JP_Practitioner では identifier ではなく
// qualification:medicalRegistrationNumber スライスに入れる。
export const MEDICAL_REGISTRATION_NUMBER_SYSTEM =
  "http://jpfhir.jp/fhir/core/mhlw/IdSystem/medicalRegistrationNumber";
const MEDICAL_LICENSE_CERTIFICATE_SYSTEM =
  "http://jpfhir.jp/fhir/core/CodeSystem/JP_MedicalLicenseCertificate_CS";
const MEDICAL_REGISTRATION_CODE = "medical-registration";

export interface PractitionerFormValues extends JapaneseNameParts {
  medicalRegistrationNumber: string;
  gender: Gender;
  birthDate: string;
  active: boolean;
  phone: string;
  email: string;
}

export const emptyPractitionerForm: PractitionerFormValues = {
  ...emptyJapaneseName,
  medicalRegistrationNumber: "",
  gender: "",
  birthDate: "",
  active: true,
  phone: "",
  email: "",
};

export function validatePractitionerForm(values: PractitionerFormValues): string | null {
  if (!values.familyKanji.trim() && !values.givenKanji.trim()) {
    return "氏名(漢字)は姓・名のいずれかを入力してください。";
  }
  return null;
}

function medicalRegistrationQualification(value: string): fhir4.PractitionerQualification {
  return {
    identifier: [{ system: MEDICAL_REGISTRATION_NUMBER_SYSTEM, value }],
    code: {
      coding: [{ system: MEDICAL_LICENSE_CERTIFICATE_SYSTEM, code: MEDICAL_REGISTRATION_CODE }],
    },
  };
}

export function buildPractitioner(values: PractitionerFormValues, id?: string): fhir4.Practitioner {
  const practitioner: fhir4.Practitioner = {
    resourceType: "Practitioner",
    active: values.active,
  };

  if (id) practitioner.id = id;

  const names = buildJapaneseNames(values);
  if (names.length) practitioner.name = names;

  if (values.medicalRegistrationNumber) {
    practitioner.qualification = [
      medicalRegistrationQualification(values.medicalRegistrationNumber),
    ];
    // 上流の identifier 検索はトップレベルの identifier しか索引しないため、
    // プロファイル上の置き場所(qualification)に加えてこちらにも同じ値を書く。
    practitioner.identifier = [
      { system: MEDICAL_REGISTRATION_NUMBER_SYSTEM, value: values.medicalRegistrationNumber },
    ];
  }

  if (values.gender) practitioner.gender = values.gender;
  if (values.birthDate) practitioner.birthDate = values.birthDate;

  const telecom: fhir4.ContactPoint[] = [];
  if (values.phone) telecom.push({ system: "phone", value: values.phone });
  if (values.email) telecom.push({ system: "email", value: values.email });
  if (telecom.length) practitioner.telecom = telecom;

  return practitioner;
}

// 医籍登録番号はプロファイルどおりの qualification から取り、見つからなければ
// 他システム由来のデータのために identifier も見る。
export function practitionerRegistrationNumber(practitioner: fhir4.Practitioner): string {
  const qualification = practitioner.qualification?.find((q) =>
    q.identifier?.some((i) => i.system === MEDICAL_REGISTRATION_NUMBER_SYSTEM),
  );
  const fromQualification = qualification?.identifier?.find(
    (i) => i.system === MEDICAL_REGISTRATION_NUMBER_SYSTEM,
  )?.value;
  if (fromQualification) return fromQualification;

  const identifier =
    practitioner.identifier?.find((i) => i.system === MEDICAL_REGISTRATION_NUMBER_SYSTEM) ??
    practitioner.identifier?.[0];
  return identifier?.value ?? "";
}

export function parsePractitioner(practitioner: fhir4.Practitioner): PractitionerFormValues {
  return {
    ...parseJapaneseNames(practitioner.name),
    medicalRegistrationNumber: practitionerRegistrationNumber(practitioner),
    gender: (practitioner.gender as Gender) ?? "",
    birthDate: practitioner.birthDate ?? "",
    active: practitioner.active ?? true,
    phone: practitioner.telecom?.find((t) => t.system === "phone")?.value ?? "",
    email: practitioner.telecom?.find((t) => t.system === "email")?.value ?? "",
  };
}

export function practitionerDisplayName(practitioner: fhir4.Practitioner): string {
  return (
    displayJapaneseName(practitioner.name) ||
    practitionerRegistrationNumber(practitioner) ||
    "(氏名未登録)"
  );
}

export function practitionerDisplayKana(practitioner: fhir4.Practitioner): string {
  return displayJapaneseKana(practitioner.name);
}
