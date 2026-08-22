import type { WardGrid } from "../api/queries";
import { locationDisplayName } from "../fhir/locationHelpers";
import { bedShortLabel, type BedRoomIds } from "../fhir/wardHelpers";

// 病棟 → 病室 → ベッドの絞り込みセレクト。入院予定・入院実施・転室・転棟予定の
// モーダルで共用する。データ(病棟一覧・病棟グリッド)は親が useWardOptions /
// useWardGrid で取って渡す。親が参照先の表示名も引けるように、選択は id だけを
// 返し、名前は resolveBedSelection(fhir/wardHelpers.ts)で同じデータから解決する。

export function BedRoomSelects({
  wards,
  grid,
  value,
  onChange,
  showWard = true,
  wardLabel = "病棟(必須)",
  roomLabel = "病室",
  bedLabel = "ベッド",
  occupiedBedIds,
}: {
  wards: fhir4.Location[];
  grid: WardGrid;
  value: BedRoomIds;
  onChange: (next: BedRoomIds) => void;
  /** 病棟が固定のモーダル(転室・転床)では false にして病室からにする。 */
  showWard?: boolean;
  wardLabel?: string;
  roomLabel?: string;
  bedLabel?: string;
  /** 渡すと埋まっている床を選択肢から外す(空床のみ選ばせる)。 */
  occupiedBedIds?: Set<string>;
}) {
  const beds = (grid.bedsByRoom.get(value.roomId) ?? []).filter(
    (bed) => !(bed.id && occupiedBedIds?.has(bed.id)),
  );
  // 予定からの引き継ぎなどで選択肢に無い id が入っていたら未選択として見せる。
  const roomValue = grid.rooms.some((r) => r.id === value.roomId) ? value.roomId : "";
  const bedValue = beds.some((b) => b.id === value.bedId) ? value.bedId : "";

  return (
    <>
      {showWard && (
        <label>
          {wardLabel}
          <select
            value={value.wardId}
            // 病棟を変えたら配下の選択は引き継げないので消す。
            onChange={(e) => onChange({ wardId: e.target.value, roomId: "", bedId: "" })}
          >
            <option value="">選択してください</option>
            {wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {locationDisplayName(ward)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {roomLabel}
        <select
          value={roomValue}
          onChange={(e) => onChange({ ...value, roomId: e.target.value, bedId: "" })}
          disabled={!value.wardId}
        >
          <option value="">未指定</option>
          {grid.rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {locationDisplayName(room)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {bedLabel}
        <select
          value={bedValue}
          onChange={(e) => onChange({ ...value, bedId: e.target.value })}
          disabled={!roomValue}
        >
          <option value="">未指定</option>
          {beds.map((bed) => (
            <option key={bed.id} value={bed.id}>
              {bedShortLabel(bed)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
