import { useSelfOrganization } from "../api/queries";
import { organizationInstitutionNumber } from "../fhir/organizationHelpers";

// 自院(管理 > 自院設定)に登録された保険医療機関番号。自院が未設定か、番号を
// 登録していなければ空文字。テンプレート回答のメタ初期値に使う。
export function useSelfInstitutionNumber(): string {
  const { organization } = useSelfOrganization();
  return organization ? organizationInstitutionNumber(organization) : "";
}
