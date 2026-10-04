import { useCurrentPractitioner } from "../api/authQueries";
import { usePractitionerRoles } from "../api/queries";
import { isNursingRoleCode, parsePractitionerRole } from "../fhir/practitionerRoleHelpers";

/** ログイン中の医療従事者が看護職(看護師・保健師・助産師)か。職種は基本ロールの code で見る。 */
export function useIsNursingLogin(): { isNursing: boolean; ready: boolean } {
  const me = useCurrentPractitioner();
  const roles = usePractitionerRoles(me.practitionerId ?? undefined);
  const roleCode = roles.role ? parsePractitionerRole(roles.role).roleCode : undefined;
  return { isNursing: isNursingRoleCode(roleCode), ready: !me.sessionLoading && !roles.isLoading };
}
