// 診療科(Organization / type=dept)の組み立て・復元。
// 医療機関(施設)と同じ Organization リソースを使い、次の規約で切り分ける。
//   医療機関 … partOf なし
//   診療科  … partOf あり(所属医療機関を必ず参照する)
// 上流 fhir-server は Organization の type 検索に対応していない(検索パラメータは
// _id / identifier / name / active / partof / _lastUpdated)ため、一覧の絞り込みは
// partof:missing で行う。所属医療機関を必須にしているのはこのためでもある。
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

export function departmentDisplayName(department: fhir4.Organization): string {
  return department.name || departmentCodeDisplay(departmentCode(department)) || "(名称未登録)";
}

// コード表からの一括登録。既に同じ医療機関の下に登録済みのコードは entry に入れない
// (上流は identifier の system 単独検索に対応しないため、重複判定は取得済みの
// 診療科一覧を突き合わせて行う)。
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
