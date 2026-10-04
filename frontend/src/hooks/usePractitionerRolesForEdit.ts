import { useMemo } from "react";
import { resourcesOfType, usePractitionerRoles } from "../api/queries";
import { baseRoleOf } from "../fhir/practitionerRoleHelpers";
import { useEditSnapshot } from "./useEditSnapshot";

/**
 * 医療従事者の編集フォーム用の所属ロール。開いた時点の内容(版)に固定するので、保存時に
 * ほかの人が先に所属を変えていれば 412 になる。
 */
export function usePractitionerRolesForEdit(practitionerId: string | undefined) {
  const query = useEditSnapshot(usePractitionerRoles(practitionerId), practitionerId);
  const roles = useMemo(
    () => resourcesOfType<fhir4.PractitionerRole>(query.data?.data, "PractitionerRole"),
    [query.data],
  );
  return { ...query, roles, role: baseRoleOf(roles) };
}
