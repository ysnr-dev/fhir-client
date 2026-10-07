import { useEffect, useMemo, useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import type { PatientFolderScope } from "../api/masterClient";
import { usePractitionerRoles } from "../api/queries";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { parseDepartmentRoles } from "../fhir/practitionerRoleHelpers";

/** 患者フォルダの木 1 つぶん(持ち主)。 */
export interface PatientFolderOwner {
  scope: PatientFolderScope;
  ownerId: string | null;
  ownerName: string | null;
  label: string;
  canEdit: boolean;
}

// 患者フォルダの 3 つの持ち主(院内共通 / 診療科 / 自分)。職種は問わない(看護師も仕分ける)。
// 診療科はその科を担当する人だけが書ける。backend は担当科を知らないので画面側で決める。
export function usePatientFolderOwners() {
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const practitionerRoles = usePractitionerRoles(practitionerId ?? undefined);
  const myDepartments = useMemo(
    () => parseDepartmentRoles(practitionerRoles.roles),
    [practitionerRoles.roles],
  );

  // 診療科の木に出す科。担当科の先頭(既定科)を初期値にする。
  const [departmentId, setDepartmentId] = useState("");
  useEffect(() => {
    if (!departmentId && myDepartments.length > 0) setDepartmentId(myDepartments[0].organizationId);
  }, [departmentId, myDepartments]);
  const department = myDepartments.find((d) => d.organizationId === departmentId);

  const owners: PatientFolderOwner[] = useMemo(
    () => [
      { scope: "facility", ownerId: null, ownerName: null, label: "院内共通", canEdit: true },
      {
        scope: "department",
        ownerId: department?.organizationId ?? null,
        ownerName: department?.name ?? null,
        label: department?.name ?? "診療科",
        canEdit: Boolean(department),
      },
      {
        scope: "practitioner",
        ownerId: practitionerId,
        ownerName: practitioner ? practitionerDisplayName(practitioner) || null : null,
        label: "自分のフォルダ",
        canEdit: Boolean(practitionerId),
      },
    ],
    [department, practitionerId, practitioner],
  );

  return {
    owners,
    myDepartments,
    departmentId,
    setDepartmentId,
    practitionerId,
    practitionerName: practitioner ? practitionerDisplayName(practitioner) : "",
  };
}
