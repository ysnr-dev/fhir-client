import { Link } from "react-router-dom";
import { useDeleteOrganization } from "../api/queries";
import {
  organizationDisplayName,
  organizationInstitutionNumber,
  organizationTypeCode,
  organizationTypeLabel,
} from "../fhir/organizationHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

export function OrganizationTable({ organizations }: { organizations: fhir4.Organization[] }) {
  const deleteOrganization = useDeleteOrganization();

  function handleDelete(organization: fhir4.Organization) {
    if (!organization.id) return;
    const label = organizationDisplayName(organization);
    if (!window.confirm(`${label} を削除します。よろしいですか?`)) return;
    deleteOrganization.mutate(organization.id);
  }

  if (organizations.length === 0) {
    return <p className="patient-table__empty">該当する医療機関が見つかりませんでした。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteOrganization.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>保険医療機関番号</th>
            <th>医療機関名</th>
            <th>種別</th>
            <th>電話番号</th>
            <th>所在地</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {organizations.map((organization) => (
            <tr key={organization.id}>
              <td>{organizationInstitutionNumber(organization) || "-"}</td>
              <td>{organizationDisplayName(organization)}</td>
              <td>{organizationTypeLabel(organizationTypeCode(organization))}</td>
              <td>{organization.telecom?.find((t) => t.system === "phone")?.value ?? "-"}</td>
              <td>{organization.address?.[0]?.text ?? "-"}</td>
              <td>{organization.active === false ? "無効" : "有効"}</td>
              <td className="patient-table__actions">
                <RowMenu label={`${organizationDisplayName(organization)} の操作`}>
                  <Link className="row-menu__item" to={`/organizations/${organization.id}/edit`}>
                    編集
                  </Link>
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    onClick={() => handleDelete(organization)}
                    disabled={deleteOrganization.isPending}
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
