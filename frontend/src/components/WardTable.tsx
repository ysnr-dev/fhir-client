import { Link } from "react-router-dom";
import { useDeleteWard } from "../api/queries";
import { locationDisplayName, locationStatusLabel } from "../fhir/locationHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

export function WardTable({
  wards,
  roomCounts,
}: {
  wards: fhir4.Location[];
  /** 病棟 id -> 病室数。 */
  roomCounts: Map<string, number>;
}) {
  const deleteWard = useDeleteWard();

  function handleDelete(ward: fhir4.Location) {
    if (!ward.id) return;
    if (!window.confirm(`${locationDisplayName(ward)} を削除します。よろしいですか?`)) return;
    deleteWard.mutate(ward.id);
  }

  if (wards.length === 0) {
    return <p className="patient-table__empty">該当する病棟が見つかりませんでした。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteWard.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>病棟名</th>
            <th>病室数</th>
            <th>状態</th>
            <th>備考</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {wards.map((ward) => (
            <tr key={ward.id}>
              <td>{locationDisplayName(ward)}</td>
              <td>{roomCounts.get(ward.id ?? "") ?? 0}</td>
              <td>{locationStatusLabel(ward.status)}</td>
              <td>{ward.description ?? "-"}</td>
              <td className="patient-table__actions schedule-table__actions">
                {/* 病棟を作った後にいちばん使うのは病室の登録なので、ケバブの外に出す
                    (予約枠カレンダーと同じ扱い)。 */}
                <Link className="button schedule-table__calendar" to={`/wards/${ward.id}/rooms`}>
                  病室管理
                </Link>
                <RowMenu label={`${locationDisplayName(ward)} の操作`}>
                  <Link className="row-menu__item" to={`/wards/${ward.id}/edit`}>
                    編集
                  </Link>
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    onClick={() => handleDelete(ward)}
                    disabled={deleteWard.isPending}
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
