// 医療従事者の職種・所属(PractitionerRole)。1 人につき次の 2 種類を扱う。
//
//   所属ロール … 1 件。organization = 所属医療機関。「職種・所属」。
//   診療科ロール … 0〜N 件。organization = 診療科 Organization。うち 1 件が既定診療科。
//
// 両者は下の PRIMARY_DEPARTMENT_EXT_URL 拡張の有無で区別する。診療科ロールには
// 既定・非既定にかかわらず必ずこの拡張が付き(既定のみ valueBoolean = true)、
// 所属ロールには付かない。診療科は医療機関と同じ Organization なので、
// organization の参照先だけでは両者を判別できないため目印が要る。
//
// JP_PractitionerRole の code は JP_PractitionerRole_VS への preferred binding だが、
// その値セットが指す JP_PractitionerRole_CS は JP Core の IG に同梱されておらず、
// 使えるコード表が存在しない(SS-MIX2 の JSHR004 は 7 コードで、しかも
// 「依頼医師・実施医師・実施技師」という役割寄りで職種を表せない)。
// そこで職種は下の独自 CodeSystem で持ち、コードは HPKI(厚労省認可、MEDIS 運営)が
// 電子署名の対象とする国家資格 27 種に揃える。JP Core がコード表を公開したら
// ここを差し替える。
import { SSMIX2_DEPARTMENT_CODE_SYSTEM } from "./departmentCodes";

const PRACTITIONER_ROLE_SYSTEM = "http://fhir-client.local/CodeSystem/practitioner-role";

export const PRIMARY_DEPARTMENT_EXT_URL =
  "http://fhir-client.local/StructureDefinition/practitioner-role-primary-department";

export const PRACTITIONER_ROLE_OPTIONS = [
  { code: "doctor", label: "医師" },
  { code: "dentist", label: "歯科医師" },
  { code: "pharmacist", label: "薬剤師" },
  { code: "nurse", label: "看護師" },
  { code: "public-health-nurse", label: "保健師" },
  { code: "midwife", label: "助産師" },
  { code: "radiological-technologist", label: "診療放射線技師" },
  { code: "medical-technologist", label: "臨床検査技師" },
  { code: "laboratory-technician", label: "衛生検査技師" },
  { code: "clinical-engineer", label: "臨床工学技士" },
  // physio(理学療法士)・occupational(作業療法士)・speech(言語聴覚士)はリハビリの
  // 療法種別 PT/OT/ST に対応する職種。実施記録の担当療法士(Procedure.performer)に
  // 立つ。**この physio は職種のコードで、生理検査のオーダー種別 physio とは別物。**
  { code: "physio", label: "理学療法士" },
  { code: "occupational", label: "作業療法士" },
  { code: "speech", label: "言語聴覚士" },
  { code: "orthoptist", label: "視能訓練士" },
  { code: "prosthetist", label: "義肢装具士" },
  { code: "dental-hygienist", label: "歯科衛生士" },
  { code: "dental-technician", label: "歯科技工士" },
  { code: "dietitian", label: "管理栄養士" },
  { code: "emergency-technician", label: "救急救命士" },
  { code: "social-worker", label: "社会福祉士" },
  { code: "psychiatric-social-worker", label: "精神保健福祉士" },
  { code: "care-worker", label: "介護福祉士" },
  { code: "psychologist", label: "公認心理師" },
  { code: "judo-therapist", label: "柔道整復師" },
  { code: "massage-practitioner", label: "あん摩マッサージ指圧師" },
  { code: "acupuncturist", label: "はり師" },
  { code: "moxibustionist", label: "きゅう師" },
  // ここまでが HPKI の 27 資格。以下は国家資格ではないが、医事課の職員や
  // ドクターズクラークも医療従事者として登録するので職種として持つ。
  { code: "clerk", label: "事務職員" },
  { code: "medical-clerk", label: "医師事務作業補助者" },
] as const;

export function practitionerRoleLabel(code: string | undefined): string {
  if (!code) return "";
  return PRACTITIONER_ROLE_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

// オーダーの依頼医師になれる職種。歯科医師も依頼者になれるので医師と同じ扱いにする。
export const DOCTOR_ROLE_CODES: readonly string[] = ["doctor", "dentist"];

export function isDoctorRoleCode(code: string | undefined): boolean {
  return Boolean(code && DOCTOR_ROLE_CODES.includes(code));
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

function roleCodeableConcept(roleCode: string): fhir4.CodeableConcept {
  return {
    coding: [
      {
        system: PRACTITIONER_ROLE_SYSTEM,
        code: roleCode,
        display: practitionerRoleLabel(roleCode),
      },
    ],
  };
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
    role.code = [roleCodeableConcept(values.roleCode)];
  }

  if (values.organizationId) {
    role.organization = {
      reference: `Organization/${values.organizationId}`,
      ...(values.organizationName ? { display: values.organizationName } : {}),
    };
  }

  return role;
}

// ---- 診療科ロール ----

export interface PractitionerDepartmentValues {
  /** 診療科 Organization.id。 */
  organizationId: string;
  name: string;
  /** SS-MIX2 統一診療科コード(未設定の院内独自科もあるので空になり得る)。 */
  code: string;
  primary: boolean;
}

export function isDepartmentRole(role: fhir4.PractitionerRole): boolean {
  return role.extension?.some((e) => e.url === PRIMARY_DEPARTMENT_EXT_URL) ?? false;
}

export function departmentRolesOf(roles: fhir4.PractitionerRole[]): fhir4.PractitionerRole[] {
  return roles.filter(isDepartmentRole);
}

/** 職種・所属医療機関を持つロール(診療科ロールではないもの)。 */
export function baseRoleOf(roles: fhir4.PractitionerRole[]): fhir4.PractitionerRole | undefined {
  return roles.find((role) => !isDepartmentRole(role));
}

// 職種(code)は所属ロール側だけに持たせる。診療科ロールにも入れると
// role 検索(職種で医療従事者を絞る)で同じ人が診療科の数だけ重複ヒットするため。
export function buildDepartmentRole(
  department: PractitionerDepartmentValues,
  practitionerReference: string,
  id?: string,
): fhir4.PractitionerRole {
  const role: fhir4.PractitionerRole = {
    resourceType: "PractitionerRole",
    active: true,
    practitioner: { reference: practitionerReference },
    organization: {
      reference: `Organization/${department.organizationId}`,
      ...(department.name ? { display: department.name } : {}),
    },
    extension: [{ url: PRIMARY_DEPARTMENT_EXT_URL, valueBoolean: department.primary }],
  };

  if (id) role.id = id;

  // specialty にも診療科コードを入れておくと、ロール単体で「どの科か」が分かり、
  // 上流の specialty 検索でも引ける。
  if (department.code) {
    role.specialty = [
      {
        coding: [
          {
            system: SSMIX2_DEPARTMENT_CODE_SYSTEM,
            code: department.code,
            ...(department.name ? { display: department.name } : {}),
          },
        ],
      },
    ];
  }

  return role;
}

export function parseDepartmentRole(role: fhir4.PractitionerRole): PractitionerDepartmentValues {
  return {
    organizationId: role.organization?.reference?.split("/").pop() ?? "",
    name: role.organization?.display ?? "",
    code:
      role.specialty?.[0]?.coding?.find((c) => c.system === SSMIX2_DEPARTMENT_CODE_SYSTEM)?.code ??
      "",
    primary:
      role.extension?.find((e) => e.url === PRIMARY_DEPARTMENT_EXT_URL)?.valueBoolean === true,
  };
}

// 診療科ロールを画面用の値に直す。既定を先頭に、残りは診療科コード順に並べる。
export function parseDepartmentRoles(
  roles: fhir4.PractitionerRole[],
): PractitionerDepartmentValues[] {
  return departmentRolesOf(roles)
    .map(parseDepartmentRole)
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      return a.code.localeCompare(b.code) || a.name.localeCompare(b.name, "ja");
    });
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

// 一覧表示用。医療従事者 id → その職種・所属(診療科ロールは除く)。
export function rolesByPractitionerId(
  roles: fhir4.PractitionerRole[],
): Record<string, fhir4.PractitionerRole> {
  const map: Record<string, fhir4.PractitionerRole> = {};
  for (const role of roles) {
    if (isDepartmentRole(role)) continue;
    const practitionerId = practitionerIdOfRole(role);
    if (practitionerId && !map[practitionerId]) map[practitionerId] = role;
  }
  return map;
}

// 一覧表示用。医療従事者 id → 紐づく診療科(既定が先頭)。
export function departmentsByPractitionerId(
  roles: fhir4.PractitionerRole[],
): Record<string, PractitionerDepartmentValues[]> {
  const map: Record<string, fhir4.PractitionerRole[]> = {};
  for (const role of departmentRolesOf(roles)) {
    const practitionerId = practitionerIdOfRole(role);
    if (!practitionerId) continue;
    (map[practitionerId] ??= []).push(role);
  }
  return Object.fromEntries(
    Object.entries(map).map(([id, practitionerRoles]) => [id, parseDepartmentRoles(practitionerRoles)]),
  );
}
