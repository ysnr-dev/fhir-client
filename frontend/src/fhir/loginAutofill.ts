// テンプレートの項目に「ログイン中の医療従事者(と所属医療機関)から自動入力する」
// ことを指定する独自拡張。入る値の種類は「医療機関の項目」「医療従事者の項目」
// (organizationField.ts / practitionerField.ts)と同じで、選択ボタンを押す代わりに
// 回答フォームを開いた時点で初期回答として入る。
//
// 医療機関側はログイン中の医療従事者の PractitionerRole.organization を辿った
// Organization を使う(所属が未登録なら何も入らない)。
import {
  organizationFieldOf,
  organizationFieldValue,
} from "./organizationField";
import { parseOrganization } from "./organizationHelpers";
import { practitionerFieldOf, practitionerFieldValue } from "./practitionerField";

export const LOGIN_AUTOFILL_EXT_URL =
  "http://fhir-client.local/StructureDefinition/questionnaire-login-autofill";

export function loginAutofillOf(item: fhir4.QuestionnaireItem): boolean {
  return (
    item.extension?.some((e) => e.url === LOGIN_AUTOFILL_EXT_URL && e.valueBoolean === true) ?? false
  );
}

// 自動入力の材料。administrator ログインや認証不要モードでは医療従事者が
// 紐付かないため、そもそも source を組み立てない(hooks/useLoginAutofillSource.ts)。
export interface LoginAutofillSource {
  practitioner: fhir4.Practitioner;
  /** 職種・所属医療機関(1 人につき 1 件)。未登録なら undefined。 */
  role?: fhir4.PractitionerRole;
  /** role.organization を辿った医療機関。未登録なら undefined。 */
  organization?: fhir4.Organization;
}

// 項目に入れる値。自動入力の対象外、または登録が無い項目は "" を返す。
export function loginAutofillValue(
  item: fhir4.QuestionnaireItem,
  source: LoginAutofillSource,
): string {
  if (!loginAutofillOf(item)) return "";

  const practitionerCode = practitionerFieldOf(item);
  if (practitionerCode) {
    return practitionerFieldValue(source.practitioner, source.role, practitionerCode);
  }

  const organizationCode = organizationFieldOf(item);
  if (organizationCode && source.organization) {
    return organizationFieldValue(parseOrganization(source.organization), organizationCode);
  }

  return "";
}
