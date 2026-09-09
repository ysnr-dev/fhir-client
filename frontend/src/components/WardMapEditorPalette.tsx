import { locationDisplayName } from "../fhir/locationHelpers";
import { bedShortLabel } from "../fhir/wardHelpers";
import { FIXTURE_KINDS, type AddTemplate, type UnplacedLocations } from "../fhir/wardMapHelpers";

// 病棟マップ編集の左ペイン。設備と、まだ置いていない病室・ベッドを並べる。
// 項目は掴んでキャンバスへ運ぶか、押して表示中央に置く。

export function WardMapEditorPalette({
  unplaced,
  staleCount,
  onPointerDown,
  onClick,
  onRemoveStale,
}: {
  unplaced: UnplacedLocations;
  /** Location が消えた病室・ベッドの数。 */
  staleCount: number;
  onPointerDown: (template: AddTemplate, event: React.PointerEvent) => void;
  onClick: (template: AddTemplate) => void;
  onRemoveStale: () => void;
}) {
  function item(key: string, template: AddTemplate, label: string, sub?: string) {
    return (
      <button
        key={key}
        type="button"
        className={`ward-map-edit__palette-item ward-map-edit__palette-item--${template.type}`}
        onPointerDown={(event) => onPointerDown(template, event)}
        onClick={() => onClick(template)}
      >
        <span>{label}</span>
        {sub && <span className="ward-map-edit__palette-sub">{sub}</span>}
      </button>
    );
  }

  return (
    <div className="ward-map-edit__palette">
      {staleCount > 0 && (
        <div className="ward-map-edit__palette-section ward-map-edit__palette-section--stale">
          <h3>削除された場所 {staleCount}</h3>
          <button type="button" onClick={onRemoveStale}>
            まとめて除く
          </button>
        </div>
      )}

      <div className="ward-map-edit__palette-section">
        <h3>設備</h3>
        <div className="ward-map-edit__palette-items">
          {FIXTURE_KINDS.map((def) => item(def.kind, { type: "fixture", kind: def.kind }, def.label))}
        </div>
      </div>

      <div className="ward-map-edit__palette-section">
        <h3>未配置の病室 {unplaced.rooms.length}</h3>
        <div className="ward-map-edit__palette-items">
          {unplaced.rooms.map((room) => item(room.id ?? "", { type: "room", room }, locationDisplayName(room)))}
        </div>
      </div>

      <div className="ward-map-edit__palette-section">
        <h3>未配置のベッド {unplaced.beds.length}</h3>
        <div className="ward-map-edit__palette-items">
          {unplaced.beds.map(({ bed, room }) =>
            item(bed.id ?? "", { type: "bed", bed, room }, `ベッド ${bedShortLabel(bed)}`, locationDisplayName(room)),
          )}
        </div>
      </div>
    </div>
  );
}
