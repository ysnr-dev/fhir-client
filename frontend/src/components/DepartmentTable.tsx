import { Link } from "react-router-dom";
import { useDeleteOrganization, useOrganizationOptions } from "../api/queries";
import { departmentCode, departmentDisplayName, departmentPartOfId } from "../fhir/departmentHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

export function DepartmentTable({ departments }: { departments: fhir4.Organization[] }) {
  const deleteDepartment = useDeleteOrganization();
  const { organizations } = useOrganizationOptions();

  function organizationName(department: fhir4.Organization): string {
    const partOfId = departmentPartOfId(department);
    const organization = organizations.find((o) => o.id === partOfId);
    return organization ? organizationDisplayName(organization) : (partOfId ?? "-");
  }

  function handleDelete(department: fhir4.Organization) {
    if (!department.id) return;
    if (!window.confirm(`${departmentDisplayName(department)} を削除します。よろしいですか?`)) return;
    deleteDepartment.mutate(department.id);
  }

  if (departments.length === 0) {
    return <p className="patient-table__empty">該当する診療科が見つかりませんでした。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteDepartment.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>診療科コード</th>
            <th>診療科名</th>
            <th>所属医療機関</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {departments.map((department) => (
            <tr key={department.id}>
              <td>{departmentCode(department) || "-"}</td>
              <td>{departmentDisplayName(department)}</td>
              <td>{organizationName(department)}</td>
              <td>{department.active === false ? "無効" : "有効"}</td>
              <td className="patient-table__actions">
                <RowMenu label={`${departmentDisplayName(department)} の操作`}>
                  <Link className="row-menu__item" to={`/departments/${department.id}/edit`}>
                    編集
                  </Link>
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    onClick={() => handleDelete(department)}
                    disabled={deleteDepartment.isPending}
                  >
                    削除
                  </button>
                </RowMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
