import { useMemo } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import type { OrderSetScope } from "../api/masterClient";
import { useMyCareTeams, usePractitionerRoles } from "../api/queries";
import { careTeamName } from "../fhir/careTeamHelpers";
import {
  baseRoleOf,
  isDoctorRoleCode,
  parseDepartmentRoles,
  parsePractitionerRole,
} from "../fhir/practitionerRoleHelpers";
import { useOrderContext } from "./useOrderContext";

/** 持ち主の選択肢(院内共通 / 診療科 / 自分 / 自分のチーム)。呼び出し元が canEdit を見て保存先を出し分ける。 */
export interface DefinitionOwnerOption {
  scope: OrderSetScope;
  ownerId: string | null;
  ownerName: string | null;
  label: string;
  canEdit: boolean;
}

/** 選択肢を見分けるキー(チームは scope が同じで持ち主が違う)。 */
export function definitionOwnerKey(owner: { scope: OrderSetScope; ownerId: string | null }): string {
  return `${owner.scope}:${owner.ownerId ?? ""}`;
}

/**
 * 持ち主ごとに保存する定義(チャート定義・データ抽出の条件)の持ち主の選択肢。
 * 院内共通・診療科に書けるのは医師だけ(backend では医師かどうかが分からないので画面で絞る)。
 * 自分の定義は医療従事者なら誰でも持てる。診療科はヘッダーで選んでいる依頼科を優先し、
 * 無ければ担当科の先頭。自分が構成員のチーム(チーム医療)は構成員なら誰でも書ける
 * (チームの条件 = スクリーニング一覧。docs/care-team-design.md §5)。ready は自分・診療科・チームが
 * 決まったか(決まる前に一覧を引くと院内共通だけを一度返してちらつく)。
 */
export function useDefinitionOwners(personalLabel: string) {
  const { practitionerId, practitioner, sessionLoading } = useCurrentPractitioner();
  const practitionerRoles = usePractitionerRoles(practitionerId ?? undefined);
  const myTeams = useMyCareTeams(practitionerId);
  const baseRole = baseRoleOf(practitionerRoles.roles);
  const isDoctor = isDoctorRoleCode(baseRole ? parsePractitionerRole(baseRole).roleCode : undefined);
  const myDepartments = useMemo(() => parseDepartmentRoles(practitionerRoles.roles), [practitionerRoles.roles]);
  const orderContext = useOrderContext();
  const department =
    myDepartments.find((d) => d.organizationId === orderContext.departmentId) ?? myDepartments[0];

  const practitionerName = practitioner
    ? practitioner.name?.[0]?.text ||
      [practitioner.name?.[0]?.family, ...(practitioner.name?.[0]?.given ?? [])].filter(Boolean).join(" ")
    : "";
  const owners: DefinitionOwnerOption[] = useMemo(
    () => [
      { scope: "facility", ownerId: null, ownerName: null, label: "院内共通", canEdit: isDoctor },
      {
        scope: "department",
        ownerId: department?.organizationId ?? null,
        ownerName: department?.name ?? null,
        label: department?.name ?? "診療科",
        canEdit: isDoctor && Boolean(department),
      },
      {
        scope: "practitioner",
        ownerId: practitionerId,
        ownerName: practitionerName || null,
        label: personalLabel,
        canEdit: Boolean(practitionerId),
      },
      ...(myTeams.data ?? []).map((team) => ({
        scope: "team" as const,
        ownerId: team.id ?? null,
        ownerName: careTeamName(team) || null,
        label: `チーム: ${careTeamName(team)}`,
        canEdit: true,
      })),
    ],
    [isDoctor, department, practitionerId, practitionerName, personalLabel, myTeams.data],
  );

  const ready = !sessionLoading && (!practitionerId || (!practitionerRoles.isPending && !myTeams.isPending));
  const teamIds = useMemo(() => (myTeams.data ?? []).map((team) => team.id ?? "").filter(Boolean), [myTeams.data]);
  return {
    owners,
    ready,
    departmentId: department?.organizationId,
    practitionerId: practitionerId ?? undefined,
    practitionerName,
    /** 自分が構成員のチーム(定義の一覧をチームの分も引くのに渡す)。 */
    teamIds,
  };
}

/** 保存済みの定義の持ち主の選択肢(書けるかどうかを見るのに使う)。 */
export function definitionOwnerOf(
  owners: DefinitionOwnerOption[],
  record: { scope: OrderSetScope; owner_id: string | null },
): DefinitionOwnerOption | undefined {
  return owners.find((o) => o.scope === record.scope && (o.scope === "facility" || o.ownerId === record.owner_id));
}
