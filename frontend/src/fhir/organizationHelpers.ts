// 医療機関(Organization)の組み立て・復元。
// 上流 fhir-server は JP_Organization プロファイルを想定し、org-1 制約
// (identifier か name の少なくとも一方が必須)だけを検証する。
import { INSTITUTION_NUMBER_PATTERN } from "./questionnaireResponseHelpers";

// JP Core の保険医療機関番号の識別子体系。
export const INSURANCE_MEDICAL_INSTITUTION_NO_SYSTEM =
  "http://jpfhir.jp/fhir/core/IdSystem/insurance-medical-institution-no";

// Organization.type は HL7 の organization-type を使う(JP Core も同じ CodeSystem)。
const ORGANIZATION_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/organization-type";

export const ORGANIZATION_TYPE_OPTIONS = [
  { code: "prov", label: "医療提供施設" },
  { code: "dept", label: "部門・診療科" },
  { code: "ins", label: "保険者" },
  { code: "other", label: "その他" },
] as const;

export function organizationTypeLabel(code: string | undefined): string {
  if (!code) return "-";
  return ORGANIZATION_TYPE_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

export interface OrganizationFormValues {
  institutionNumber: string;
  name: string;
  typeCode: string;
  active: boolean;
  phone: string;
  fax: string;
  postalCode: string;
  addressText: string;
}

export const emptyOrganizationForm: OrganizationFormValues = {
  institutionNumber: "",
  name: "",
  typeCode: "prov",
  active: true,
  phone: "",
  fax: "",
  postalCode: "",
  addressText: "",
};

// 未入力は許容し、入力された場合だけ 10 桁の書式を要求する
// (org-1 は名称だけでも満たせるため、番号を持たない施設も登録できるようにする)。
export function validateOrganizationForm(values: OrganizationFormValues): string | null {
  if (!values.name.trim()) return "医療機関名は必須です。";
  if (values.institutionNumber && !INSTITUTION_NUMBER_PATTERN.test(values.institutionNumber)) {
    return "保険医療機関番号は10桁の数字(都道府県2桁 + 点数表1桁 + 医療機関コード7桁)で入力してください。";
  }
  return null;
}

export function buildOrganization(values: OrganizationFormValues, id?: string): fhir4.Organization {
  const organization: fhir4.Organization = {
    resourceType: "Organization",
    active: values.active,
    name: values.name.trim(),
  };

  if (id) organization.id = id;

  if (values.institutionNumber) {
    organization.identifier = [
      { system: INSURANCE_MEDICAL_INSTITUTION_NO_SYSTEM, value: values.institutionNumber },
    ];
  }

  if (values.typeCode) {
    organization.type = [
      {
        coding: [
          {
            system: ORGANIZATION_TYPE_SYSTEM,
            code: values.typeCode,
            display: organizationTypeLabel(values.typeCode),
          },
        ],
      },
    ];
  }

  const telecom: fhir4.ContactPoint[] = [];
  if (values.phone) telecom.push({ system: "phone", value: values.phone });
  if (values.fax) telecom.push({ system: "fax", value: values.fax });
  if (telecom.length) organization.telecom = telecom;

  if (values.postalCode || values.addressText) {
    const address: fhir4.Address = {};
    if (values.addressText) address.text = values.addressText;
    if (values.postalCode) address.postalCode = values.postalCode;
    organization.address = [address];
  }

  return organization;
}

export function parseOrganization(organization: fhir4.Organization): OrganizationFormValues {
  const identifier =
    organization.identifier?.find((i) => i.system === INSURANCE_MEDICAL_INSTITUTION_NO_SYSTEM) ??
    organization.identifier?.[0];
  const address = organization.address?.[0];

  return {
    institutionNumber: identifier?.value ?? "",
    name: organization.name ?? "",
    typeCode: organizationTypeCode(organization) ?? "",
    active: organization.active ?? true,
    phone: organization.telecom?.find((t) => t.system === "phone")?.value ?? "",
    fax: organization.telecom?.find((t) => t.system === "fax")?.value ?? "",
    postalCode: address?.postalCode ?? "",
    addressText: address?.text ?? "",
  };
}

export function organizationTypeCode(organization: fhir4.Organization): string | undefined {
  const coding = organization.type?.[0]?.coding;
  return (
    coding?.find((c) => c.system === ORGANIZATION_TYPE_SYSTEM)?.code ?? coding?.[0]?.code ?? undefined
  );
}

export function organizationInstitutionNumber(organization: fhir4.Organization): string {
  const identifier =
    organization.identifier?.find((i) => i.system === INSURANCE_MEDICAL_INSTITUTION_NO_SYSTEM) ??
    organization.identifier?.[0];
  return identifier?.value ?? "";
}

export function organizationDisplayName(organization: fhir4.Organization): string {
  return organization.name || organizationInstitutionNumber(organization) || "(名称未登録)";
}
