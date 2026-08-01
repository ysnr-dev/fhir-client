// テンプレートの項目に「医療機関(Organization)のどの情報を入れるか」を指定する
// 独自拡張。回答フォームでは、この拡張を持つ子項目があるグループに
// 「医療機関を選択」ボタンが出て、選んだ Organization の値が一括で入る。
//
// JASPEHR は item.type "reference" を禁止している(questionnaire-item-type-Jaspehr)
// ため、Organization 参照そのものは回答に持てない。選択結果は文字列としてコピー
// されるだけで、「どの Organization を選んだか」は保存されない。
import { parseOrganization, type OrganizationFormValues } from "./organizationHelpers";

export const ORGANIZATION_FIELD_EXT_URL =
  "http://fhir-client.local/StructureDefinition/questionnaire-organization-field";

export const ORGANIZATION_FIELD_OPTIONS = [
  { code: "name", label: "名称" },
  { code: "institutionNumber", label: "保険医療機関番号" },
  { code: "addressFull", label: "郵便番号+所在地" },
  { code: "address", label: "所在地" },
  { code: "postalCode", label: "郵便番号" },
  { code: "phone", label: "電話番号" },
  { code: "fax", label: "ＦＡＸ" },
] as const;

export type OrganizationFieldCode = (typeof ORGANIZATION_FIELD_OPTIONS)[number]["code"];

export function isOrganizationFieldCode(code: string): code is OrganizationFieldCode {
  return ORGANIZATION_FIELD_OPTIONS.some((o) => o.code === code);
}

export function organizationFieldLabel(code: string): string {
  return ORGANIZATION_FIELD_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

export function organizationFieldOf(item: fhir4.QuestionnaireItem): string {
  return item.extension?.find((e) => e.url === ORGANIZATION_FIELD_EXT_URL)?.valueCode ?? "";
}

// 医療機関の登録内容から、指定コードに対応する文字列を取り出す。
// 未登録の項目は空文字を返す(呼び出し側はこれで既存入力を上書きする)。
export function organizationFieldValue(values: OrganizationFormValues, code: string): string {
  switch (code) {
    case "name":
      return values.name;
    case "institutionNumber":
      return values.institutionNumber;
    case "addressFull":
      // 郵便番号は Organization に登録されていても差し込み先の欄が
      // 分かれていないことが多いため、所在地と連結した形も選べるようにする。
      return [values.postalCode && `〒${values.postalCode}`, values.addressText]
        .filter(Boolean)
        .join(" ");
    case "address":
      return values.addressText;
    case "postalCode":
      return values.postalCode;
    case "phone":
      return values.phone;
    case "fax":
      return values.fax;
    default:
      return "";
  }
}

export interface OrganizationFieldTarget {
  /** 回答 state のインスタンスパス(グループの子プレフィックス + linkId)。 */
  key: string;
  label: string;
  code: string;
}

// グループ直下の医療機関項目を集める。入れ子のグループは対象にしない
// (そのグループ自身にボタンが出るため、取りこぼしにはならない)。
export function organizationFieldTargets(
  group: fhir4.QuestionnaireItem,
  childPrefix: string,
): OrganizationFieldTarget[] {
  return (group.item ?? []).flatMap((child) => {
    const code = organizationFieldOf(child);
    if (!code) return [];
    return [{ key: childPrefix + child.linkId, label: child.text ?? child.linkId, code }];
  });
}

// 選択した Organization を、対象項目の回答値へ展開する。
export function organizationFieldAnswers(
  targets: OrganizationFieldTarget[],
  organization: fhir4.Organization,
): Record<string, string> {
  const values = parseOrganization(organization);
  return Object.fromEntries(
    targets.map((target) => [target.key, organizationFieldValue(values, target.code)]),
  );
}
