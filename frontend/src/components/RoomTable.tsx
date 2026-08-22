import { Link } from "react-router-dom";
import { useDeleteRoom } from "../api/queries";
import { locationDisplayName, locationStatusLabel } from "../fhir/locationHelpers";
import { partOfId, roomClassCode, roomClassLabel } from "../fhir/wardHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";

export function RoomTable({
  wardId,
  rooms,
  beds,
  bedCounts,
}: {
  wardId: string;
  rooms: fhir4.Location[];
  /** 表示中の病室にぶら下がるベッド。削除で巻き込むために実体で受ける。 */
  beds: fhir4.Location[];
  /** 病室 id -> ベッド数。 */
  bedCounts: Map<string, number>;
}) {
  const deleteRoom = useDeleteRoom();

  function handleDelete(room: fhir4.Location) {
    if (!room.id) return;
    const roomBeds = beds.filter((bed) => partOfId(bed) === room.id);
    const label = locationDisplayName(room);
    const bedNote = roomBeds.length > 0 ? `ベッド${roomBeds.length}床もあわせて削除されます。` : "";
    if (!window.confirm(`${label} を削除します。${bedNote}よろしいですか?`)) return;
    deleteRoom.mutate({ roomId: room.id, beds: roomBeds });
  }

  if (rooms.length === 0) {
    return <p className="patient-table__empty">この病棟にはまだ病室が登録されていません。</p>;
  }

  return (
    <>
      <ErrorBanner error={deleteRoom.error} />
      <table className="patient-table">
        <thead>
          <tr>
            <th>病室名</th>
            <th>区分</th>
            <th>ベッド数</th>
            <th>状態</th>
            <th>備考</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.id}>
              <td>{locationDisplayName(room)}</td>
              <td>{roomClassLabel(roomClassCode(room))}</td>
              <td>{bedCounts.get(room.id ?? "") ?? 0}</td>
              <td>{locationStatusLabel(room.status)}</td>
              <td>{room.description ?? "-"}</td>
              <td className="patient-table__actions">
                <RowMenu label={`${locationDisplayName(room)} の操作`}>
                  <Link
                    className="row-menu__item"
                    to={`/wards/${wardId}/rooms/${room.id}/edit`}
                  >
                    編集
                  </Link>
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    onClick={() => handleDelete(room)}
                    disabled={deleteRoom.isPending}
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
