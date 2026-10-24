import { referenceId } from "./shared";

// チーム医療のチーム(docs/care-team-design.md §1)。NST・ICT・褥瘡対策・緩和ケアなどの組織的なチームを
// 上流の CareTeam で持つ(subject を持たないので患者コンパートメントには入らない)。チーム依頼の宛先
// (ServiceRequest.performer)とスクリーニングの保存条件の持ち主になる。

export const CARE_TEAM_KIND_SYSTEM = "http://fhir-client.local/CodeSystem/care-team-kind";
export const CARE_TEAM_ROLE_SYSTEM = "http://fhir-client.local/CodeSystem/care-team-role";
export const CARE_TEAM_ROUND_TEMPLATE_EXT_URL = "http://fhir-client.local/StructureDefinition/care-team-round-template";

export const CARE_TEAM_KIND_OPTIONS = [
  { code: "nst", label: "栄養サポート(NST)" },
  { code: "ict", label: "感染対策(ICT)" },
  { code: "ast", label: "抗菌薬適正使用(AST)" },
  { code: "pressure-ulcer", label: "褥瘡対策" },
  { code: "palliative", label: "緩和ケア" },
  { code: "dementia", label: "認知症ケア" },
  { code: "rst", label: "呼吸ケア(RST)" },
  { code: "other", label: "その他" },
] as const;

export type CareTeamKind = (typeof CARE_TEAM_KIND_OPTIONS)[number]["code"];

export const CARE_TEAM_ROLE_OPTIONS = [
  { code: "lead", label: "リーダー" },
  { code: "member", label: "メンバー" },
] as const;

export type CareTeamRole = (typeof CARE_TEAM_ROLE_OPTIONS)[number]["code"];

export function careTeamKindLabel(code: string | undefined): string {
  return CARE_TEAM_KIND_OPTIONS.find((o) => o.code === code)?.label ?? code ?? "";
}

export function careTeamRoleLabel(code: string | undefined): string {
  return CARE_TEAM_ROLE_OPTIONS.find((o) => o.code === code)?.label ?? code ?? "";
}

export interface CareTeamMember {
  practitionerId: string;
  name: string;
  role: CareTeamRole;
}

export interface CareTeamFormValues {
  name: string;
  kind: CareTeamKind;
  active: boolean;
  /** 回診記録に挿入する既定テンプレートの canonical。空は無し。 */
  roundTemplate: string;
}

export function emptyCareTeamForm(): CareTeamFormValues {
  return { name: "", kind: "nst", active: true, roundTemplate: "" };
}

export function careTeamKind(team: fhir4.CareTeam): string {
  return team.category?.[0]?.coding?.find((c) => c.system === CARE_TEAM_KIND_SYSTEM)?.code ?? "";
}

export function careTeamName(team: fhir4.CareTeam): string {
  return team.name ?? "";
}

export function careTeamRoundTemplate(team: fhir4.CareTeam): string {
  return team.extension?.find((e) => e.url === CARE_TEAM_ROUND_TEMPLATE_EXT_URL)?.valueCanonical ?? "";
}

export function careTeamMembers(team: fhir4.CareTeam): CareTeamMember[] {
  return (team.participant ?? []).flatMap((p) => {
    const practitionerId = referenceId(p.member?.reference);
    if (!practitionerId || !p.member?.reference?.startsWith("Practitioner/")) return [];
    const role = p.role?.[0]?.coding?.find((c) => c.system === CARE_TEAM_ROLE_SYSTEM)?.code;
    return [{ practitionerId, name: p.member.display ?? "", role: role === "lead" ? "lead" : "member" }];
  });
}

export function isCareTeamMember(team: fhir4.CareTeam, practitionerId: string | null | undefined): boolean {
  return Boolean(practitionerId) && careTeamMembers(team).some((m) => m.practitionerId === practitionerId);
}

export function parseCareTeamForm(team: fhir4.CareTeam): CareTeamFormValues {
  const kind = careTeamKind(team);
  return {
    name: careTeamName(team),
    kind: CARE_TEAM_KIND_OPTIONS.some((o) => o.code === kind) ? (kind as CareTeamKind) : "other",
    active: team.status !== "inactive",
    roundTemplate: careTeamRoundTemplate(team),
  };
}

function participantOf(member: CareTeamMember): fhir4.CareTeamParticipant {
  return {
    role: [{ coding: [{ system: CARE_TEAM_ROLE_SYSTEM, code: member.role, display: careTeamRoleLabel(member.role) }] }],
    member: { reference: `Practitioner/${member.practitionerId}`, ...(member.name ? { display: member.name } : {}) },
  };
}

/** チームの組み立て。existing があれば id・メンバー・meta を引き継ぎ、フォームの値だけ書き換える。 */
export function buildCareTeam(
  values: CareTeamFormValues,
  members: CareTeamMember[],
  options: { selfOrganizationId?: string | null; existing?: fhir4.CareTeam },
): fhir4.CareTeam {
  const existing = options.existing;
  const rest = (existing?.extension ?? []).filter((e) => e.url !== CARE_TEAM_ROUND_TEMPLATE_EXT_URL);
  const extension = values.roundTemplate
    ? [...rest, { url: CARE_TEAM_ROUND_TEMPLATE_EXT_URL, valueCanonical: values.roundTemplate }]
    : rest;
  const team: fhir4.CareTeam = {
    resourceType: "CareTeam",
    ...(existing?.id ? { id: existing.id, meta: existing.meta } : {}),
    status: values.active ? "active" : "inactive",
    category: [
      { coding: [{ system: CARE_TEAM_KIND_SYSTEM, code: values.kind, display: careTeamKindLabel(values.kind) }] },
    ],
    name: values.name.trim(),
    participant: members.map(participantOf),
    ...(options.selfOrganizationId
      ? { managingOrganization: [{ reference: `Organization/${options.selfOrganizationId}` }] }
      : existing?.managingOrganization
        ? { managingOrganization: existing.managingOrganization }
        : {}),
    ...(extension.length > 0 ? { extension } : {}),
  };
  return team;
}

/** メンバーの入れ替え(フォームの値はそのまま)。 */
export function withCareTeamMembers(team: fhir4.CareTeam, members: CareTeamMember[]): fhir4.CareTeam {
  return { ...team, participant: members.map(participantOf) };
}

export function validateCareTeamForm(values: CareTeamFormValues): string | null {
  if (!values.name.trim()) return "チーム名は必須です。";
  return null;
}
