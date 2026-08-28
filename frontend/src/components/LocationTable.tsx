import { Link } from "react-router-dom";
import { useDeleteLocation } from "../api/queries";
import {
  locationDisplayName,
  locationDisplayOrder,
  locationStatusLabel,
  locationTypeCode,
  locationTypeLabel,
} from "../fhir/locationHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

export function LocationTable({ locations }: { locations: fhir4.Location[] }) {
  const deleteLocation = useDeleteLocation();

  function handleDelete(location: fhir4.Location) {
    if (!location.id) return;
    const label = locationDisplayName(location);
    if (!window.confirm(`${label} を削除します。よろしいですか?`)) return;
    deleteLocation.mutate(location.id);
  }

  if (locations.length === 0) {
    return <p className="patient-table__empty">該当する場所が見つかりませんでした。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteLocation.error} />
      <table className="patient-table">
        <thead>
          <tr>
            {/* 一覧はこの順には並べない(ページングの途中で並べても嘘になる)。
                番号を見比べて直せればよいので、値だけを出す。 */}
            <th>表示順</th>
            <th>名称</th>
            <th>種別</th>
            <th>状態</th>
            <th>備考</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {locations.map((location) => (
            <tr key={location.id}>
              <td>{locationDisplayOrder(location) ?? "-"}</td>
              <td>{locationDisplayName(location)}</td>
              <td>{locationTypeLabel(locationTypeCode(location))}</td>
              <td>{locationStatusLabel(location.status)}</td>
              <td>{location.description ?? "-"}</td>
              <td className="patient-table__actions">
                <RowMenu label={`${locationDisplayName(location)} の操作`}>
                  <Link className="row-menu__item" to={`/locations/${location.id}/edit`}>
                    編集
                  </Link>
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    onClick={() => handleDelete(location)}
                    disabled={deleteLocation.isPending}
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
