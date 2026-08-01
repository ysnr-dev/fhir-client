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
import {
  buildPractitionerRole,
  emptyPractitionerRole,
  hasPractitionerRole,
  type PractitionerRoleValues,
} from "./practitionerRoleHelpers";

// 医籍登録番号。JP_Practitioner では identifier ではなく
// qualification:medicalRegistrationNumber スライスに入れる。
export const MEDICAL_REGISTRATION_NUMBER_SYSTEM =
  "http://jpfhir.jp/fhir/core/mhlw/IdSystem/medicalRegistrationNumber";
const MEDICAL_LICENSE_CERTIFICATE_SYSTEM =
  "http://jpfhir.jp/fhir/core/CodeSystem/JP_MedicalLicenseCertificate_CS";
const MEDICAL_REGISTRATION_CODE = "medical-registration";

// Practitioner リソース自体の項目。職種・所属は別リソース(PractitionerRole)だが、
// 画面では 1 つのフォームとして扱う。
export interface PractitionerValues extends JapaneseNameParts {
  medicalRegistrationNumber: string;
  gender: Gender;
  birthDate: string;
  active: boolean;
  phone: string;
  email: string;
}

export interface PractitionerFormValues extends PractitionerValues, PractitionerRoleValues {}

export const emptyPractitionerForm: PractitionerFormValues = {
  ...emptyJapaneseName,
  ...emptyPractitionerRole,
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

export function buildPractitioner(values: PractitionerValues, id?: string): fhir4.Practitioner {
  const practitioner: fhir4.Practitioner = {
    resourceType: "Practitioner",
    active: values.active,
  };

  if (id) practitioner.id = id;

  const names = buildJapaneseNames(values);
  if (names.length) practitioner.name = names;

  if (values.medicalRegistrationNumber) {
    // プロファイル上の置き場所は qualification。上流は qualification[].identifier も
    // identifier 検索の索引に含めるため、トップレベルへの二重書きは不要。
    practitioner.qualification = [
      medicalRegistrationQualification(values.medicalRegistrationNumber),
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

export function parsePractitioner(practitioner: fhir4.Practitioner): PractitionerValues {
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

// 医療従事者と職種・所属(PractitionerRole)を 1 つの transaction Bundle で保存する。
// 片方だけ保存されて職種の無い医療従事者や孤児 PractitionerRole が残るのを防ぐ。
// 職種・所属が両方空になったら、既存の PractitionerRole は削除する。
export function buildPractitionerSaveBundle(args: {
  values: PractitionerFormValues;
  practitionerId?: string;
  etag?: string;
  existingRoleId?: string;
}): fhir4.Bundle {
  const { values, practitionerId, etag, existingRoleId } = args;
  const practitionerReference = practitionerId
    ? `Practitioner/${practitionerId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  const entry: fhir4.BundleEntry[] = [
    {
      fullUrl: practitionerReference,
      resource: buildPractitioner(values, practitionerId),
      request: practitionerId
        ? {
            method: "PUT",
            url: `Practitioner/${practitionerId}`,
            ...(etag ? { ifMatch: etag } : {}),
          }
        : { method: "POST", url: "Practitioner" },
    },
  ];

  if (hasPractitionerRole(values)) {
    entry.push({
      resource: buildPractitionerRole(values, practitionerReference, existingRoleId),
      request: existingRoleId
        ? { method: "PUT", url: `PractitionerRole/${existingRoleId}` }
        : { method: "POST", url: "PractitionerRole" },
    });
  } else if (existingRoleId) {
    entry.push({ request: { method: "DELETE", url: `PractitionerRole/${existingRoleId}` } });
  }

  return { resourceType: "Bundle", type: "transaction", entry };
}

// 医療従事者の削除。ぶら下がっている PractitionerRole も同じ Bundle で消す。
export function buildPractitionerDeleteBundle(
  practitionerId: string,
  roleIds: string[],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...roleIds.map((id) => ({ request: { method: "DELETE" as const, url: `PractitionerRole/${id}` } })),
      { request: { method: "DELETE", url: `Practitioner/${practitionerId}` } },
    ],
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
