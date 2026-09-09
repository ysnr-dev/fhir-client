import { locationDisplayName } from "../fhir/locationHelpers";
import { roomClassCode, roomClassLabel } from "../fhir/wardHelpers";

// 病棟マップの病室の枠。上 1 マスに病室名と区分を出す。
// 病室の Location が消えていれば欠番として赤枠にする(エディタで除ける)。

export function WardMapRoomFrame({ room }: { room: fhir4.Location | undefined }) {
  const classCode = room ? roomClassCode(room) : undefined;
  return (
    <div className={`ward-map__room${room ? "" : " ward-map__room--stale"}${classCode ? ` ward-map__room--${classCode}` : ""}`}>
      <div className="ward-map__room-title">
        <span className="ward-map__room-name">{room ? locationDisplayName(room) : "(削除された病室)"}</span>
        {classCode && <span className="ward-map__room-class">{roomClassLabel(classCode)}</span>}
      </div>
    </div>
  );
}
