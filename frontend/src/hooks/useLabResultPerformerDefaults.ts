import { useCallback } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useSelfOrganization } from "../api/queries";
import type { LabResultPerformer } from "../fhir/labResultHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";

/**
 * 検査結果の実施施設・実施者の既定値。画面には出さず、自院とログインユーザーを
 * 保存時に焼き付ける。空欄のときだけ入れるので、編集しても最初に登録した人が残る。
 *
 * 手入力のフォームと取込画面の双方から使う(同じ値を 2 か所で組まないため)。
 */
export function useLabResultPerformerDefaults() {
  const selfOrganization = useSelfOrganization();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const organization = selfOrganization.organization;

  const fill = useCallback(
    (performer: LabResultPerformer): LabResultPerformer => ({
      organizationId: performer.organizationId || (organization?.id ?? ""),
      organizationName:
        performer.organizationName || (organization ? organizationDisplayName(organization) : ""),
      practitionerId: performer.practitionerId || (practitionerId ?? ""),
      practitionerName:
        performer.practitionerName || (practitioner ? practitionerDisplayName(practitioner) : ""),
    }),
    [organization, practitionerId, practitioner],
  );

  return { fill, practitionerId: practitionerId ?? "" };
}
