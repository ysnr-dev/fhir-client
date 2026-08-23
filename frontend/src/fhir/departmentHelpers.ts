// 診療科(Organization / type=dept)の組み立て・復元。
// 医療機関(施設)と同じ Organization リソースを使い、次の規約で切り分ける。
//   医療機関 … partOf なし
//   診療科  … partOf あり(所属医療機関を必ず参照する)
// 一覧の絞り込みは partof:missing で行う。上流は type 検索にも対応しているが、
// 診療科を診療科たらしめているのは所属医療機関を持つこと(このファイルの
// validateDepartmentForm が必須にしている不変条件)で、type は冗長な付加情報だから。
import {
  SSMIX2_DEPARTMENT_CODE_SYSTEM,
  departmentCodeDisplay,
  type DepartmentCode,
} from "./departmentCodes";

const ORGANIZATION_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/organization-type";
const DEPARTMENT_TYPE_CODE = "dept";

export interface DepartmentFormValues {
  /** SS-MIX2 統一診療科コードの 2 ケタ科。任意(院内独自の科は空でも登録できる)。 */
  code: string;
  name: string;
  /** 所属医療機関の Organization.id。必須。 */
  partOfId: string;
  active: boolean;
}

export const emptyDepartmentForm: DepartmentFormValues = {
  code: "",
  name: "",
  partOfId: "",
  active: true,
};

export function validateDepartmentForm(values: DepartmentFormValues): string | null {
  if (!values.name.trim()) return "診療科名は必須です。";
  if (!values.partOfId) return "所属医療機関は必須です。";
  return null;
}

export function buildDepartment(values: DepartmentFormValues, id?: string): fhir4.Organization {
  const department: fhir4.Organization = {
    resourceType: "Organization",
    active: values.active,
    name: values.name.trim(),
    type: [
      {
        coding: [
          { system: ORGANIZATION_TYPE_SYSTEM, code: DEPARTMENT_TYPE_CODE, display: "部門・診療科" },
        ],
      },
    ],
    partOf: { reference: `Organization/${values.partOfId}` },
  };

  if (id) department.id = id;

  if (values.code) {
    department.identifier = [{ system: SSMIX2_DEPARTMENT_CODE_SYSTEM, value: values.code }];
  }

  return department;
}

export function parseDepartment(department: fhir4.Organization): DepartmentFormValues {
  return {
    code: departmentCode(department),
    name: department.name ?? "",
    partOfId: departmentPartOfId(department) ?? "",
    active: department.active ?? true,
  };
}

export function departmentCode(department: fhir4.Organization): string {
  return (
    department.identifier?.find((i) => i.system === SSMIX2_DEPARTMENT_CODE_SYSTEM)?.value ?? ""
  );
}

export function departmentPartOfId(department: fhir4.Organization): string | undefined {
  return department.partOf?.reference?.split("/").pop() || undefined;
}

// 診療科コードの昇順。コードは "01"〜"9Z" の 2 文字なので単純な文字列比較でよい。
// コード未設定(院内独自の科)は末尾にまとめ、その中では名称順にする。
export function sortDepartmentsByCode(departments: fhir4.Organization[]): fhir4.Organization[] {
  return [...departments].sort((a, b) => {
    const codeA = departmentCode(a);
    const codeB = departmentCode(b);
    if (codeA && codeB) return codeA.localeCompare(codeB);
    if (codeA) return -1;
    if (codeB) return 1;
    return (a.name ?? "").localeCompare(b.name ?? "", "ja");
  });
}

export function departmentDisplayName(department: fhir4.Organization): string {
  return department.name || departmentCodeDisplay(departmentCode(department)) || "(名称未登録)";
}

// コード表からの一括登録。既に同じ医療機関の下に登録済みのコードは entry に入れない
// (重複判定は、その医療機関の診療科を全件取ってコードを突き合わせて行う。
// コード表の 87 件を 1 件ずつ問い合わせるより 1 回読み切る方が安い)。
export function buildDepartmentSeedBundle(
  codes: readonly DepartmentCode[],
  partOfId: string,
  existing: fhir4.Organization[],
): fhir4.Bundle {
  const registered = new Set(existing.map(departmentCode).filter(Boolean));

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: codes
      .filter((c) => !registered.has(c.code))
      .map((c) => ({
        resource: buildDepartment({
          code: c.code,
          name: c.display,
          partOfId,
          active: true,
        }),
        request: { method: "POST" as const, url: "Organization" },
      })),
  };
}
