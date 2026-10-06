import { useMemo } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import type { OrderSetScope } from "../api/masterClient";
import { usePractitionerRoles } from "../api/queries";
import {
  baseRoleOf,
  isDoctorRoleCode,
  parseDepartmentRoles,
  parsePractitionerRole,
} from "../fhir/practitionerRoleHelpers";
import { useOrderContext } from "./useOrderContext";

/** 持ち主の選択肢(院内共通 / 診療科 / 自分)。呼び出し元が canEdit を見て保存先を出し分ける。 */
export interface DefinitionOwnerOption {
  scope: OrderSetScope;
  ownerId: string | null;
  ownerName: string | null;
  label: string;
  canEdit: boolean;
}

/**
 * 持ち主ごとに保存する定義(チャート定義・データ抽出の条件)の持ち主の選択肢。
 * 院内共通・診療科に書けるのは医師だけ(backend では医師かどうかが分からないので画面で絞る)。
 * 自分の定義は医療従事者なら誰でも持てる。診療科はヘッダーで選んでいる依頼科を優先し、
 * 無ければ担当科の先頭。ready は自分・診療科が決まったか(決まる前に一覧を引くと院内共通だけを
 * 一度返してちらつく)。
 */
export function useDefinitionOwners(personalLabel: string) {
  const { practitionerId, practitioner, sessionLoading } = useCurrentPractitioner();
  const practitionerRoles = usePractitionerRoles(practitionerId ?? undefined);
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
    ],
    [isDoctor, department, practitionerId, practitionerName, personalLabel],
  );

  const ready = !sessionLoading && (!practitionerId || !practitionerRoles.isPending);
  return {
    owners,
    ready,
    departmentId: department?.organizationId,
    practitionerId: practitionerId ?? undefined,
    practitionerName,
  };
}
