import { Link } from "react-router-dom";
import { useDeletePractitioner } from "../api/queries";
import { genderLabel } from "../fhir/patientHelpers";
import {
  practitionerDisplayKana,
  practitionerDisplayName,
  practitionerRegistrationNumber,
} from "../fhir/practitionerHelpers";
import {
  departmentsByPractitionerId,
  practitionerRoleLabel,
  parsePractitionerRole,
  rolesByPractitionerId,
  type PractitionerDepartmentValues,
} from "../fhir/practitionerRoleHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

interface PractitionerTableProps {
  practitioners: fhir4.Practitioner[];
  /** 一覧と一緒に取得した PractitionerRole(職種・所属医療機関・所属診療科の表示に使う)。 */
  roles: fhir4.PractitionerRole[];
  /** 編集画面のルート。連携先医師の一覧は /partner-practitioners を渡す。 */
  basePath?: string;
}

// 既定診療科を先頭に出し、他にもあれば件数を添える。
function departmentSummary(departments: PractitionerDepartmentValues[] | undefined): string {
  if (!departments?.length) return "-";
  const [primary, ...rest] = departments;
  const label = primary.code ? `${primary.code} ${primary.name}` : primary.name;
  return rest.length ? `${label} 他${rest.length}件` : label;
}

export function PractitionerTable({
  practitioners,
  roles,
  basePath = "/practitioners",
}: PractitionerTableProps) {
  const deletePractitioner = useDeletePractitioner();
  const roleByPractitioner = rolesByPractitionerId(roles);
  const departmentsByPractitioner = departmentsByPractitionerId(roles);

  function handleDelete(practitioner: fhir4.Practitioner) {
    if (!practitioner.id) return;
    if (!window.confirm(`${practitionerDisplayName(practitioner)} を削除します。よろしいですか?`)) {
      return;
    }
    deletePractitioner.mutate(practitioner.id);
  }

  if (practitioners.length === 0) {
    return <p className="patient-table__empty">該当する医療従事者が見つかりませんでした。</p>;
  }

  return (
    <>
      <ErrorBanner error={deletePractitioner.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>医籍登録番号</th>
            <th>氏名</th>
            <th>カナ</th>
            <th>職種</th>
            <th>所属医療機関</th>
            <th>所属診療科</th>
            <th>性別</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {practitioners.map((practitioner) => {
            const role = practitioner.id ? roleByPractitioner[practitioner.id] : undefined;
            const roleValues = role ? parsePractitionerRole(role) : undefined;
            return (
            <tr key={practitioner.id}>
              <td>{practitionerRegistrationNumber(practitioner) || "-"}</td>
              <td>{practitionerDisplayName(practitioner)}</td>
              <td>{practitionerDisplayKana(practitioner)}</td>
              <td>{practitionerRoleLabel(roleValues?.roleCode) || "-"}</td>
              <td>{roleValues?.organizationName || "-"}</td>
              <td>
                {departmentSummary(
                  practitioner.id ? departmentsByPractitioner[practitioner.id] : undefined,
                )}
              </td>
              <td>{genderLabel(practitioner.gender)}</td>
              <td>{practitioner.active === false ? "無効" : "有効"}</td>
              <td className="patient-table__actions">
                <RowMenu label={`${practitionerDisplayName(practitioner)} の操作`}>
                  <Link className="row-menu__item" to={`${basePath}/${practitioner.id}/edit`}>
                    編集
                  </Link>
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    onClick={() => handleDelete(practitioner)}
                    disabled={deletePractitioner.isPending}
                  >
                    削除
                  </button>
                </RowMenu>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
