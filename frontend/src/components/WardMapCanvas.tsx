import { useMemo, type ReactNode, type RefObject } from "react";
import { objectStyle, type BedObject, type WardGridLike, type WardMapLayout } from "../fhir/wardMapHelpers";
import { WardMapFixture } from "./WardMapFixture";
import { WardMapRoomFrame } from "./WardMapRoomFrame";

// 病棟マップのキャンバス。閲覧と編集で共用する。
//
// オブジェクトはマス座標 × grid_size の px で絶対配置し、拡大縮小は内側の要素の
// transform(scale)で行う。外側の要素は拡大後の大きさを持たせて、スクロール領域が
// 正しい範囲を持つようにする(transform は配置に影響しないため)。
// 当たり判定は呼び出し側が内側の要素の getBoundingClientRect(scale 込み)から
// clientToGrid で解く。オブジェクトごとの ref は持たない。

export interface WardMapCanvasProps {
  layout: WardMapLayout;
  grid: WardGridLike;
  zoom: number;
  /** 内側(scale を掛ける)の要素。当たり判定に使う。 */
  canvasRef?: RefObject<HTMLDivElement | null>;
  /** ベッドの描き方。閲覧は患者カード、編集は番号だけの札。 */
  renderBed: (object: BedObject, bed: fhir4.Location | undefined, room: fhir4.Location | undefined) => ReactNode;
  /** 選択枠やハンドルなど、オブジェクトの上に重ねるもの(scale の内側に置かれる)。 */
  children?: ReactNode;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  /** 選択中のオブジェクト(編集)。 */
  selectedIds?: ReadonlySet<string>;
  className?: string;
}

export function WardMapCanvas({
  layout,
  grid,
  zoom,
  canvasRef,
  renderBed,
  children,
  onPointerDown,
  selectedIds,
  className,
}: WardMapCanvasProps) {
  const gridSize = layout.grid_size;
  const width = layout.canvas.width * gridSize;
  const height = layout.canvas.height * gridSize;

  const roomsById = useMemo(
    () => new Map(grid.rooms.map((room) => [room.id ?? "", room])),
    [grid.rooms],
  );
  const bedsById = useMemo(
    () => new Map([...grid.bedsByRoom.values()].flat().map((bed) => [bed.id ?? "", bed])),
    [grid.bedsByRoom],
  );

  return (
    <div
      className={`ward-map__canvas-outer${className ? ` ${className}` : ""}`}
      style={{ width: width * zoom, height: height * zoom }}
    >
      <div
        ref={canvasRef}
        className="ward-map__canvas"
        style={{
          width,
          height,
          transform: `scale(${zoom})`,
          backgroundSize: `${gridSize}px ${gridSize}px`,
          // 1 マスの px。病室名の帯の高さなど、CSS 側でマス単位を使うところに渡す。
          ["--ward-map-grid" as string]: `${gridSize}px`,
        }}
        onPointerDown={onPointerDown}
      >
        {layout.objects.map((object) => {
          const selected = selectedIds?.has(object.id);
          const classes = `ward-map__object ward-map__object--${object.type}${selected ? " is-selected" : ""}`;
          return (
            <div key={object.id} className={classes} style={objectStyle(object, gridSize)} data-object-id={object.id}>
              {object.type === "fixture" && <WardMapFixture object={object} />}
              {object.type === "room" && <WardMapRoomFrame room={roomsById.get(object.location_id)} />}
              {object.type === "bed" &&
                renderBed(object, bedsById.get(object.location_id), roomsById.get(object.room_id))}
            </div>
          );
        })}
        {children}
      </div>
    </div>
  );
}
