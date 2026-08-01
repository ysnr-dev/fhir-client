import { useAuthSession } from "../api/authQueries";
import { useOrganization, usePractitioner, usePractitionerRole } from "../api/queries";
import type { LoginAutofillSource } from "../fhir/loginAutofill";
import { parsePractitionerRole } from "../fhir/practitionerRoleHelpers";

// テンプレート項目の自動入力(loginAutofill.ts)に使う、ログイン中の医療従事者・
// 職種所属・所属医療機関をまとめて取得する。
//
// 回答フォームは初期回答をマウント時に一度だけ確定するため、呼び出し側は ready を
// 待ってからフォームを描画すること。administrator ログインや認証不要モードでは
// 紐付く Practitioner が無く、source は undefined・ready は true になる。
export function useLoginAutofillSource(): { source?: LoginAutofillSource; ready: boolean } {
  const session = useAuthSession();
  const practitionerId = session.data?.user?.practitioner_id ?? undefined;

  const practitionerQuery = usePractitioner(practitionerId);
  const roleQuery = usePractitionerRole(practitionerId);
  const organizationId = roleQuery.role ? parsePractitionerRole(roleQuery.role).organizationId : "";
  const organizationQuery = useOrganization(organizationId || undefined);

  const practitioner = practitionerQuery.data?.data;

  // 未指定・未ログインで disabled になったクエリの isLoading は false のままなので、
  // 「所属が無い医療従事者」でも待ち続けることはない。
  const ready =
    !session.isLoading &&
    !practitionerQuery.isLoading &&
    !roleQuery.isLoading &&
    !organizationQuery.isLoading;

  return {
    source: practitioner
      ? {
          practitioner,
          role: roleQuery.role,
          organization: organizationQuery.data?.data,
        }
      : undefined,
    ready,
  };
}
