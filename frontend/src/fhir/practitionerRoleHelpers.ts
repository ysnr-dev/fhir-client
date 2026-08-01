// 医療従事者の職種・所属医療機関(PractitionerRole)。
// 本アプリでは 1 人につき 1 件だけ扱う(医療従事者フォームの一部として登録する)。
//
// JP_PractitionerRole の code は JP_PractitionerRole_VS への preferred binding で、
// 上流はコード値を検証しない。ここでは HL7 の practitioner-role CodeSystem を使う。

const PRACTITIONER_ROLE_SYSTEM = "http://terminology.hl7.org/CodeSystem/practitioner-role";

export const PRACTITIONER_ROLE_OPTIONS = [
  { code: "doctor", label: "医師" },
  { code: "dentist", label: "歯科医師" },
  { code: "pharmacist", label: "薬剤師" },
  { code: "nurse", label: "看護師" },
  { code: "physio", label: "理学療法士" },
  { code: "speech", label: "言語聴覚士" },
  { code: "researcher", label: "研究者" },
  { code: "teacher", label: "教員" },
] as const;

export function practitionerRoleLabel(code: string | undefined): string {
  if (!code) return "";
  return PRACTITIONER_ROLE_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

export interface PractitionerRoleValues {
  roleCode: string;
  organizationId: string;
  /** 参照の display に入れる医療機関名(一覧で Organization を引き直さずに表示するため)。 */
  organizationName: string;
}

export const emptyPractitionerRole: PractitionerRoleValues = {
  roleCode: "",
  organizationId: "",
  organizationName: "",
};

export function hasPractitionerRole(values: PractitionerRoleValues): boolean {
  return Boolean(values.roleCode || values.organizationId);
}

export function buildPractitionerRole(
  values: PractitionerRoleValues,
  practitionerReference: string,
  id?: string,
): fhir4.PractitionerRole {
  const role: fhir4.PractitionerRole = {
    resourceType: "PractitionerRole",
    active: true,
    practitioner: { reference: practitionerReference },
  };

  if (id) role.id = id;

  if (values.roleCode) {
    role.code = [
      {
        coding: [
          {
            system: PRACTITIONER_ROLE_SYSTEM,
            code: values.roleCode,
            display: practitionerRoleLabel(values.roleCode),
          },
        ],
      },
    ];
  }

  if (values.organizationId) {
    role.organization = {
      reference: `Organization/${values.organizationId}`,
      ...(values.organizationName ? { display: values.organizationName } : {}),
    };
  }

  return role;
}

export function parsePractitionerRole(role: fhir4.PractitionerRole): PractitionerRoleValues {
  const coding = role.code?.[0]?.coding;
  return {
    roleCode:
      coding?.find((c) => c.system === PRACTITIONER_ROLE_SYSTEM)?.code ?? coding?.[0]?.code ?? "",
    organizationId: role.organization?.reference?.split("/").pop() ?? "",
    organizationName: role.organization?.display ?? "",
  };
}

export function practitionerIdOfRole(role: fhir4.PractitionerRole): string | undefined {
  return role.practitioner?.reference?.split("/").pop() || undefined;
}

// 一覧表示用。医療従事者 id → その職種・所属。
export function rolesByPractitionerId(
  roles: fhir4.PractitionerRole[],
): Record<string, fhir4.PractitionerRole> {
  const map: Record<string, fhir4.PractitionerRole> = {};
  for (const role of roles) {
    const practitionerId = practitionerIdOfRole(role);
    if (practitionerId && !map[practitionerId]) map[practitionerId] = role;
  }
  return map;
}
