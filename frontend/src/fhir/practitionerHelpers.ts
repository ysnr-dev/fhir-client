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
  baseRoleOf,
  buildDepartmentRole,
  buildPractitionerRole,
  departmentRolesOf,
  emptyPractitionerRole,
  hasPractitionerRole,
  parseDepartmentRole,
  type PractitionerDepartmentValues,
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

export interface PractitionerFormValues extends PractitionerValues, PractitionerRoleValues {
  /** 所属診療科。所属医療機関の配下から選ぶ。1 件を既定診療科にする。 */
  departments: PractitionerDepartmentValues[];
}

export const emptyPractitionerForm: PractitionerFormValues = {
  ...emptyJapaneseName,
  ...emptyPractitionerRole,
  departments: [],
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
  if (values.departments.length > 0 && !values.departments.some((d) => d.primary)) {
    return "既定診療科を1つ選んでください。";
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

// 医療従事者と職種・所属・所属診療科(PractitionerRole)を 1 つの transaction Bundle
// で保存する。片方だけ保存されて職種の無い医療従事者や孤児 PractitionerRole が
// 残るのを防ぐ。職種・所属が両方空になったら所属ロールは削除し、外された診療科の
// ロールも同じ Bundle で消す。
export function buildPractitionerSaveBundle(args: {
  values: PractitionerFormValues;
  practitionerId?: string;
  etag?: string;
  /** 編集時に既に登録されている PractitionerRole(所属ロール・診療科ロール両方)。 */
  existingRoles?: fhir4.PractitionerRole[];
}): fhir4.Bundle {
  const { values, practitionerId, etag, existingRoles = [] } = args;
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

  const existingBaseRoleId = baseRoleOf(existingRoles)?.id;
  if (hasPractitionerRole(values)) {
    entry.push({
      resource: buildPractitionerRole(values, practitionerReference, existingBaseRoleId),
      request: existingBaseRoleId
        ? { method: "PUT", url: `PractitionerRole/${existingBaseRoleId}` }
        : { method: "POST", url: "PractitionerRole" },
    });
  } else if (existingBaseRoleId) {
    entry.push({ request: { method: "DELETE", url: `PractitionerRole/${existingBaseRoleId}` } });
  }

  // 診療科ロールは診療科 Organization ごとに 1 件。同じ診療科の既存ロールがあれば
  // id を引き継いで PUT し、選択から外れたものは DELETE する。
  const existingDepartmentRoles = departmentRolesOf(existingRoles);
  const keptRoleIds = new Set<string>();

  for (const department of values.departments) {
    const existing = existingDepartmentRoles.find(
      (role) => parseDepartmentRole(role).organizationId === department.organizationId,
    );
    if (existing?.id) keptRoleIds.add(existing.id);
    entry.push({
      resource: buildDepartmentRole(department, practitionerReference, existing?.id),
      request: existing?.id
        ? { method: "PUT", url: `PractitionerRole/${existing.id}` }
        : { method: "POST", url: "PractitionerRole" },
    });
  }

  for (const role of existingDepartmentRoles) {
    if (role.id && !keptRoleIds.has(role.id)) {
      entry.push({ request: { method: "DELETE", url: `PractitionerRole/${role.id}` } });
    }
  }

  return { resourceType: "Bundle", type: "transaction", entry };
}

// transaction レスポンス Bundle から、新規作成された Practitioner の ID を取り出す。
// entry.response.location は "Practitioner/{id}/_history/{vid}"(相対)にも
// "http://.../Practitioner/{id}/_history/{vid}"(絶対)にもなり得る。
// ログインアカウント(/auth/account)の紐付け先 practitioner_id に使う。
export function createdPractitionerId(responseBundle: fhir4.Bundle): string | undefined {
  for (const entry of responseBundle.entry ?? []) {
    const match = entry.response?.location?.match(/(?:^|\/)Practitioner\/([^/]+)/);
    if (match) return match[1];
  }
  return undefined;
}

// 医療従事者の削除。ぶら下がっている PractitionerRole も同じ Bundle で消す。
// 役割は条件付き削除でまとめて消すので、消す前に id を引き直す必要はない。
export function buildPractitionerDeleteBundle(practitionerId: string): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        request: {
          method: "DELETE",
          url: `PractitionerRole?practitioner=Practitioner/${practitionerId}`,
        },
      },
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
