// テンプレートの項目に「医療従事者(Practitioner)のどの情報を入れるか」を指定する
// 独自拡張。医療機関(organizationField.ts)と同じ仕組みで、この拡張を持つ子項目が
// あるグループに「医療従事者を選択」ボタンが出る。
//
// 職種・所属医療機関は Practitioner ではなく PractitionerRole が持つため、
// 値の展開には選択時の PractitionerRole も渡す。
import { parsePractitioner } from "./practitionerHelpers";
import { parsePractitionerRole, practitionerRoleLabel } from "./practitionerRoleHelpers";

export const PRACTITIONER_FIELD_EXT_URL =
  "http://fhir-client.local/StructureDefinition/questionnaire-practitioner-field";

// 選択モーダルの職種フィルタの初期値。テンプレート側で「担当医師名の欄なので
// 既定で医師に絞る」といった指定ができる。
export const PRACTITIONER_ROLE_DEFAULT_EXT_URL =
  "http://fhir-client.local/StructureDefinition/questionnaire-practitioner-role-default";

export const PRACTITIONER_FIELD_OPTIONS = [
  { code: "name", label: "氏名" },
  { code: "kana", label: "氏名(カナ)" },
  { code: "medicalRegistrationNumber", label: "医籍登録番号" },
  { code: "role", label: "職種" },
  { code: "organizationName", label: "所属医療機関名" },
  { code: "phone", label: "電話番号" },
  { code: "email", label: "メールアドレス" },
] as const;

export type PractitionerFieldCode = (typeof PRACTITIONER_FIELD_OPTIONS)[number]["code"];

export function isPractitionerFieldCode(code: string): code is PractitionerFieldCode {
  return PRACTITIONER_FIELD_OPTIONS.some((o) => o.code === code);
}

export function practitionerFieldLabel(code: string): string {
  return PRACTITIONER_FIELD_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

export function practitionerFieldOf(item: fhir4.QuestionnaireItem): string {
  return item.extension?.find((e) => e.url === PRACTITIONER_FIELD_EXT_URL)?.valueCode ?? "";
}

export function practitionerRoleDefaultOf(item: fhir4.QuestionnaireItem): string {
  return item.extension?.find((e) => e.url === PRACTITIONER_ROLE_DEFAULT_EXT_URL)?.valueCode ?? "";
}

export function practitionerFieldValue(
  practitioner: fhir4.Practitioner,
  role: fhir4.PractitionerRole | undefined,
  code: string,
): string {
  const values = parsePractitioner(practitioner);
  const roleValues = role ? parsePractitionerRole(role) : undefined;

  switch (code) {
    case "name":
      return [values.familyKanji, values.givenKanji].filter(Boolean).join(" ");
    case "kana":
      return [values.familyKana, values.givenKana].filter(Boolean).join(" ");
    case "medicalRegistrationNumber":
      return values.medicalRegistrationNumber;
    case "role":
      return practitionerRoleLabel(roleValues?.roleCode);
    case "organizationName":
      return roleValues?.organizationName ?? "";
    case "phone":
      return values.phone;
    case "email":
      return values.email;
    default:
      return "";
  }
}

export interface PractitionerFieldTarget {
  /** 回答 state のインスタンスパス(グループの子プレフィックス + linkId)。 */
  key: string;
  label: string;
  code: string;
}

// グループ直下の医療従事者項目を集める(医療機関と同じく直下のみ)。
export function practitionerFieldTargets(
  group: fhir4.QuestionnaireItem,
  childPrefix: string,
): PractitionerFieldTarget[] {
  return (group.item ?? []).flatMap((child) => {
    const code = practitionerFieldOf(child);
    if (!code) return [];
    return [{ key: childPrefix + child.linkId, label: child.text ?? child.linkId, code }];
  });
}

// グループ内で最初に指定されている職種の初期値(モーダルのフィルタ初期値)。
export function practitionerRoleDefaultIn(group: fhir4.QuestionnaireItem): string {
  for (const child of group.item ?? []) {
    if (!practitionerFieldOf(child)) continue;
    const roleDefault = practitionerRoleDefaultOf(child);
    if (roleDefault) return roleDefault;
  }
  return "";
}

export function practitionerFieldAnswers(
  targets: PractitionerFieldTarget[],
  practitioner: fhir4.Practitioner,
  role: fhir4.PractitionerRole | undefined,
): Record<string, string> {
  return Object.fromEntries(
    targets.map((target) => [target.key, practitionerFieldValue(practitioner, role, target.code)]),
  );
}
