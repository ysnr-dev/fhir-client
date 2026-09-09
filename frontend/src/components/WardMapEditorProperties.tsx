import { useState } from "react";
import { locationDisplayName } from "../fhir/locationHelpers";
import { bedDisplayName } from "../fhir/wardHelpers";
import {
  CANVAS_LIMITS,
  FIXTURE_KINDS,
  GRID_SIZE_LIMITS,
  canResize,
  fixtureKindDef,
  type FixtureKind,
  type FixtureObject,
  type WardGridLike,
  type WardMapLayout,
  type WardMapObject,
} from "../fhir/wardMapHelpers";

// 病棟マップ編集の右ペイン。キャンバスの大きさと、選んでいるオブジェクトの中身。
// 数値は入力のたびに反映する(適用ボタンは置かない)。

export function WardMapEditorProperties({
  layout,
  grid,
  selected,
  onCanvasChange,
  onGridSizeChange,
  onObjectChange,
  onRotate,
  onDuplicate,
  onRemove,
  onArrange,
}: {
  layout: WardMapLayout;
  grid: WardGridLike;
  selected: WardMapObject[];
  /** 収まらなければ false を返す。 */
  onCanvasChange: (width: number, height: number) => boolean;
  onGridSizeChange: (gridSize: number) => void;
  onObjectChange: (id: string, patch: Partial<WardMapObject>) => void;
  onRotate: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  /** 病室内のベッドを並べ直す。 */
  onArrange: () => void;
}) {
  const [canvasError, setCanvasError] = useState<string | null>(null);

  function changeCanvas(width: number, height: number) {
    const ok = onCanvasChange(width, height);
    setCanvasError(ok ? null : "はみ出すオブジェクトがあるので、その大きさにはできません。");
  }

  const single = selected.length === 1 ? selected[0] : null;
  const canRotate = selected.some((o) => o.type !== "room");
  const canDuplicate = selected.some((o) => o.type === "fixture");
  const canArrange = selected.some((o) => o.type === "room");

  return (
    <div className="ward-map-edit__props">
      <section className="ward-map-edit__props-section">
        <h3>キャンバス</h3>
        <div className="ward-map-edit__props-row">
          <label>
            幅
            <input
              type="number"
              min={CANVAS_LIMITS.min}
              max={CANVAS_LIMITS.max}
              value={layout.canvas.width}
              onChange={(e) => changeCanvas(Number(e.target.value), layout.canvas.height)}
            />
          </label>
          <label>
            高さ
            <input
              type="number"
              min={CANVAS_LIMITS.min}
              max={CANVAS_LIMITS.max}
              value={layout.canvas.height}
              onChange={(e) => changeCanvas(layout.canvas.width, Number(e.target.value))}
            />
          </label>
          <label>
            マス(px)
            <input
              type="number"
              min={GRID_SIZE_LIMITS.min}
              max={GRID_SIZE_LIMITS.max}
              value={layout.grid_size}
              onChange={(e) => onGridSizeChange(Number(e.target.value))}
            />
          </label>
        </div>
        {canvasError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{canvasError}</p>
          </div>
        )}
      </section>

      {selected.length === 0 && (
        <section className="ward-map-edit__props-section">
          <h3>選択なし</h3>
        </section>
      )}

      {selected.length > 1 && (
        <section className="ward-map-edit__props-section">
          <h3>{selected.length} 件を選択</h3>
          <div className="ward-map-edit__props-actions">
            {canRotate && (
              <button type="button" onClick={onRotate}>
                回転
              </button>
            )}
            {canDuplicate && (
              <button type="button" onClick={onDuplicate}>
                複製
              </button>
            )}
            {canArrange && (
              <button type="button" onClick={onArrange}>
                ベッドを整列
              </button>
            )}
            <button type="button" onClick={onRemove}>
              削除
            </button>
          </div>
        </section>
      )}

      {single && (
        <section className="ward-map-edit__props-section">
          <h3>{objectTitle(single, grid)}</h3>
          <div className="ward-map-edit__props-row">
            <label>
              X
              <input
                type="number"
                min={0}
                value={single.x}
                onChange={(e) => onObjectChange(single.id, { x: Number(e.target.value) })}
              />
            </label>
            <label>
              Y
              <input
                type="number"
                min={0}
                value={single.y}
                onChange={(e) => onObjectChange(single.id, { y: Number(e.target.value) })}
              />
            </label>
            <label>
              幅
              <input
                type="number"
                min={1}
                value={single.w}
                disabled={!canResize(single)}
                onChange={(e) => onObjectChange(single.id, { w: Math.max(1, Number(e.target.value)) })}
              />
            </label>
            <label>
              高さ
              <input
                type="number"
                min={1}
                value={single.h}
                disabled={!canResize(single)}
                onChange={(e) => onObjectChange(single.id, { h: Math.max(1, Number(e.target.value)) })}
              />
            </label>
          </div>

          {single.type === "fixture" && <FixtureFields object={single} onChange={onObjectChange} />}

          <div className="ward-map-edit__props-actions">
            {single.type !== "room" && (
              <button type="button" onClick={onRotate}>
                回転({single.rotation}°)
              </button>
            )}
            {single.type === "fixture" && (
              <button type="button" onClick={onDuplicate}>
                複製
              </button>
            )}
            {single.type === "room" && (
              <button type="button" onClick={onArrange}>
                ベッドを整列
              </button>
            )}
            <button type="button" onClick={onRemove}>
              削除
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function objectTitle(object: WardMapObject, grid: WardGridLike): string {
  switch (object.type) {
    case "fixture":
      return `設備: ${fixtureKindDef(object.kind).label}`;
    case "room": {
      const room = grid.rooms.find((r) => r.id === object.location_id);
      return `病室: ${room ? locationDisplayName(room) : "(削除済み)"}`;
    }
    case "bed": {
      const room = grid.rooms.find((r) => r.id === object.room_id);
      const bed = (grid.bedsByRoom.get(object.room_id) ?? []).find((b) => b.id === object.location_id);
      return `ベッド: ${bed ? bedDisplayName(bed, room ? locationDisplayName(room) : "") : "(削除済み)"}`;
    }
  }
}

function FixtureFields({
  object,
  onChange,
}: {
  object: FixtureObject;
  onChange: (id: string, patch: Partial<FixtureObject>) => void;
}) {
  return (
    <div className="ward-map-edit__props-row">
      <label>
        種別
        <select
          value={object.kind}
          onChange={(e) => onChange(object.id, { kind: e.target.value as FixtureKind })}
        >
          {FIXTURE_KINDS.map((def) => (
            <option key={def.kind} value={def.kind}>
              {def.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        表示名
        <input
          type="text"
          value={object.label ?? ""}
          maxLength={100}
          onChange={(e) => onChange(object.id, { label: e.target.value || undefined })}
        />
      </label>
      <label>
        色
        <span className="ward-map-edit__color">
          <input
            type="color"
            value={object.color ?? "#e4e5ea"}
            onChange={(e) => onChange(object.id, { color: e.target.value })}
          />
          <button type="button" disabled={!object.color} onClick={() => onChange(object.id, { color: undefined })}>
            既定色
          </button>
        </span>
      </label>
    </div>
  );
}
