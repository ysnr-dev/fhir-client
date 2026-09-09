import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { WardMap } from "../api/masterClient";
import { useWardMap, useWardMapMutations } from "../api/masterQueries";
import { useWardGrid, useWardOptions } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { WardMapCanvas } from "../components/WardMapCanvas";
import { WardMapEditorPalette } from "../components/WardMapEditorPalette";
import { WardMapEditorProperties } from "../components/WardMapEditorProperties";
import { locationDisplayName } from "../fhir/locationHelpers";
import { bedShortLabel } from "../fhir/wardHelpers";
import {
  addBed,
  addFixture,
  addRoom,
  arrangeBedsInRoom,
  buildInitialLayout,
  canResize,
  clientToGrid,
  duplicateObjects,
  hitTest,
  idsWithRoomBeds,
  moveObjects,
  normalizeLayout,
  objectStyle,
  pxToCells,
  removeObjects,
  RESIZE_EDGES,
  resizeCanvas,
  resizeObject,
  rotateObject,
  setGridSize,
  staleObjects,
  templateSize,
  unplacedLocations,
  updateObject,
  type AddTemplate,
  type BedObject,
  type ResizeEdge,
  type WardGridLike,
  type WardMapLayout,
  type WardMapObject,
} from "../fhir/wardMapHelpers";
import { useCardDrag, type DragState } from "../hooks/useCardDrag";
import { useUndoableState } from "../hooks/useUndoableState";
import { useWardMapViewport } from "../hooks/useWardMapViewport";

// 病棟マップの編集。設備・病室・ベッドをキャンバスに置いて、レイアウト全体を
// backend(master_ward_maps)に保存する。
//
// 掴んで動かす操作は useCardDrag(Pointer Events)で、途中経過はレイアウトに直接
// 反映して(履歴には積まず)、離したときに 1 手として記録する。キャンバスの空白を
// 掴めばスクロール(パン)。

type EditorDragItem =
  | { kind: "move"; ids: string[] }
  | { kind: "resize"; id: string; edge: ResizeEdge }
  | { kind: "add"; template: AddTemplate; w: number; h: number }
  | { kind: "pan"; scrollLeft: number; scrollTop: number };

interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function WardMapEditPage() {
  const { wardId = "" } = useParams();
  const wardOptions = useWardOptions();
  const grid = useWardGrid(wardId || undefined);
  const map = useWardMap(wardId || undefined);
  const ward = wardOptions.wards.find((w) => w.id === wardId);
  const wardName = ward ? locationDisplayName(ward) : "";

  // キャンバスは横に広いので、この画面だけ幅を広げる(入院患者一覧と同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const ready = grid.isSuccess && map.isSuccess;

  return (
    <div className="page ward-map-edit">
      {/* 見出しは置かない(閲覧側と同じ)。病棟名と閲覧への導線はツールバーに出す。 */}
      <ErrorBanner error={wardOptions.error} />
      <ErrorBanner error={grid.error} />
      <ErrorBanner error={map.error} />

      {ready ? (
        <WardMapEditor
          key={map.data?.id ?? "new"}
          wardId={wardId}
          wardName={wardName}
          grid={grid}
          map={map.data ?? null}
        />
      ) : (
        !grid.error && !map.error && <p className="master-search__empty">読み込み中...</p>
      )}
    </div>
  );
}

function WardMapEditor({
  wardId,
  wardName,
  grid,
  map,
}: {
  wardId: string;
  wardName: string;
  grid: WardGridLike;
  map: WardMap | null;
}) {
  // 初期値はサーバーのレイアウト。無ければ病室とベッドを機械的に並べたものから始める。
  const [initial] = useState(() => (map ? normalizeLayout(map.layout) : buildInitialLayout(grid)));
  const history = useUndoableState<WardMapLayout>(initial);
  const { set, commit, undo, redo, reset } = history;
  const layout = history.present;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const [mapId, setMapId] = useState<number | null>(map?.id ?? null);
  const [saved, setSaved] = useState<WardMapLayout | null>(map ? initial : null);
  const dirty = layout !== saved;
  const mutations = useWardMapMutations();
  const saving = mutations.create.isPending || mutations.update.isPending;

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selected = useMemo(
    () => layout.objects.filter((object) => selectedIds.has(object.id)),
    [layout.objects, selectedIds],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewport = useWardMapViewport(scrollRef);
  const zoom = viewport.zoom;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const unplaced = useMemo(() => unplacedLocations(layout, grid), [layout, grid]);
  const stale = useMemo(() => staleObjects(layout, grid), [layout, grid]);

  // ---- 掴んで動かす ----

  /** 掴んだ時点のレイアウト。離す(または Escape)まで持つ。 */
  const dragBase = useRef<WardMapLayout | null>(null);
  const lastDelta = useRef({ dx: 0, dy: 0 });
  const spaceHeld = useRef(false);
  const [addPreview, setAddPreview] = useState<GridRect | null>(null);

  /** client 座標を、その大きさのものを置くマス位置に直す。キャンバスの外なら null。 */
  const gridRectAt = useCallback((clientX: number, clientY: number, w: number, h: number): GridRect | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const current = layoutRef.current;
    if (!rect) return null;
    const { gx, gy } = clientToGrid(rect, current.grid_size, zoomRef.current, clientX, clientY);
    if (gx < 0 || gy < 0 || gx > current.canvas.width || gy > current.canvas.height) return null;
    return {
      x: Math.min(Math.max(Math.round(gx - w / 2), 0), current.canvas.width - w),
      y: Math.min(Math.max(Math.round(gy - h / 2), 0), current.canvas.height - h),
      w,
      h,
    };
  }, []);

  const addTemplateAt = useCallback(
    (template: AddTemplate, x: number, y: number) => {
      const current = layoutRef.current;
      const result =
        template.type === "fixture"
          ? addFixture(current, template.kind, x, y)
          : template.type === "room"
            ? addRoom(current, template.room, grid, x, y)
            : addBed(current, template.bed, template.room.id ?? "", x, y);
      set(result.layout, { record: true });
      setSelectedIds(new Set([result.id]));
    },
    [grid, set],
  );

  function handleDrop(state: DragState<EditorDragItem>) {
    const item = state.item;
    if (item.kind === "move" || item.kind === "resize") {
      // dragBase を先に空にする(同じ drop が二度来ても二重に記録しない)。
      const base = dragBase.current;
      dragBase.current = null;
      if (!base) return;
      const dx = pxToCells(state.x - state.startX, base.grid_size, zoomRef.current);
      const dy = pxToCells(state.y - state.startY, base.grid_size, zoomRef.current);
      const next =
        item.kind === "move" ? moveObjects(base, item.ids, dx, dy) : resizeObject(base, item.id, item.edge, dx, dy);
      commit(base, next);
      return;
    }
    if (item.kind === "add") {
      const base = dragBase.current;
      dragBase.current = null;
      setAddPreview(null);
      if (!base) return;
      const rect = gridRectAt(state.x, state.y, item.w, item.h);
      if (rect) addTemplateAt(item.template, rect.x, rect.y);
    }
  }

  const { drag, start, consumeClick } = useCardDrag<EditorDragItem>({ onDrop: handleDrop });

  // 掴んでいる間の途中経過。move/resize はレイアウトへ直接反映、add は枠を出す、
  // pan はスクロール位置を動かす。drag が null に戻ったのに dragBase が残っていれば
  // Escape で取りやめたので、掴む前の形に戻す。
  const activeKind = useRef<EditorDragItem["kind"] | null>(null);
  useEffect(() => {
    if (!drag) {
      const kind = activeKind.current;
      activeKind.current = null;
      // 掴まずに離した(クリック)ときの dragBase は使わずに捨てる。
      if (kind && kind !== "pan" && dragBase.current) set(dragBase.current);
      dragBase.current = null;
      setAddPreview(null);
      return;
    }
    activeKind.current = drag.item.kind;
    const item = drag.item;
    if (item.kind === "pan") {
      const container = scrollRef.current;
      if (!container) return;
      container.scrollLeft = item.scrollLeft - (drag.x - drag.startX);
      container.scrollTop = item.scrollTop - (drag.y - drag.startY);
      return;
    }
    if (item.kind === "add") {
      setAddPreview(gridRectAt(drag.x, drag.y, item.w, item.h));
      return;
    }
    const base = dragBase.current;
    if (!base) return;
    const dx = pxToCells(drag.x - drag.startX, base.grid_size, zoomRef.current);
    const dy = pxToCells(drag.y - drag.startY, base.grid_size, zoomRef.current);
    if (dx === lastDelta.current.dx && dy === lastDelta.current.dy) return;
    lastDelta.current = { dx, dy };
    set(item.kind === "move" ? moveObjects(base, item.ids, dx, dy) : resizeObject(base, item.id, item.edge, dx, dy));
  }, [drag, gridRectAt, set]);

  function beginDrag(item: EditorDragItem, event: React.PointerEvent) {
    dragBase.current = layoutRef.current;
    lastDelta.current = { dx: 0, dy: 0 };
    start(item, event);
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { gx, gy } = clientToGrid(rect, layout.grid_size, zoom, event.clientX, event.clientY);
    const hit = spaceHeld.current ? undefined : hitTest(layout, Math.floor(gx), Math.floor(gy));

    if (!hit) {
      if (!event.shiftKey) setSelectedIds(new Set());
      const container = scrollRef.current;
      if (!container) return;
      start({ kind: "pan", scrollLeft: container.scrollLeft, scrollTop: container.scrollTop }, event);
      return;
    }

    let ids: Set<string>;
    if (event.shiftKey) {
      ids = new Set(selectedIds);
      if (ids.has(hit.id)) ids.delete(hit.id);
      else ids.add(hit.id);
    } else if (selectedIds.has(hit.id)) {
      ids = new Set(selectedIds);
    } else {
      ids = new Set([hit.id]);
    }
    setSelectedIds(ids);
    if (ids.size > 0) beginDrag({ kind: "move", ids: [...ids] }, event);
  }

  function handleHandlePointerDown(event: React.PointerEvent, id: string, edge: ResizeEdge) {
    if (event.button !== 0) return;
    event.stopPropagation();
    beginDrag({ kind: "resize", id, edge }, event);
  }

  function handlePalettePointerDown(template: AddTemplate, event: React.PointerEvent) {
    const size = templateSize(template);
    beginDrag({ kind: "add", template, w: size.w, h: size.h }, event);
  }

  /** パレットを押した(掴まずに離した)ときは、見えている範囲の中央に置く。 */
  function handlePaletteClick(template: AddTemplate) {
    if (consumeClick()) return;
    const container = scrollRef.current;
    const size = templateSize(template);
    let x = 1;
    let y = 1;
    if (container) {
      const scale = layout.grid_size * zoom;
      x = Math.round((container.scrollLeft + container.clientWidth / 2) / scale - size.w / 2);
      y = Math.round((container.scrollTop + container.clientHeight / 2) / scale - size.h / 2);
    }
    x = Math.min(Math.max(x, 0), layout.canvas.width - size.w);
    y = Math.min(Math.max(y, 0), layout.canvas.height - size.h);
    addTemplateAt(template, x, y);
  }

  // ---- 選択に対する操作 ----

  const removeSelected = useCallback(() => {
    const current = layoutRef.current;
    const ids = idsWithRoomBeds(current, selectedIds);
    if (ids.size === 0) return;
    if (ids.size > selectedIds.size && !window.confirm("病室を消すと、中に置いたベッドも一緒に消えます。よろしいですか?")) {
      return;
    }
    set(removeObjects(current, ids), { record: true });
    setSelectedIds(new Set());
  }, [selectedIds, set]);

  const duplicateSelected = useCallback(() => {
    const result = duplicateObjects(layoutRef.current, selectedIds);
    if (result.ids.length === 0) return;
    set(result.layout, { record: true });
    setSelectedIds(new Set(result.ids));
  }, [selectedIds, set]);

  const rotateSelected = useCallback(() => {
    let next = layoutRef.current;
    for (const id of selectedIds) next = rotateObject(next, id);
    set(next, { record: true });
  }, [selectedIds, set]);

  /** 選んだ病室(無ければ全病室)の中のベッドを並べ直す。 */
  const arrangeRooms = useCallback(() => {
    let next = layoutRef.current;
    const targets = next.objects.filter(
      (object): object is Extract<WardMapObject, { type: "room" }> =>
        object.type === "room" && (selectedIds.size === 0 || selectedIds.has(object.id)),
    );
    for (const room of targets) {
      const current = next.objects.find((o) => o.id === room.id);
      if (current?.type === "room") next = arrangeBedsInRoom(next, current, grid);
    }
    set(next, { record: true });
  }, [grid, selectedIds, set]);

  function autoLayout() {
    if (!window.confirm("病室とベッドを並べ直し、設備を消します。よろしいですか?")) return;
    set(buildInitialLayout(grid, layout.canvas.width), { record: true });
    setSelectedIds(new Set());
  }

  function removeStale() {
    set(removeObjects(layout, stale.map((o) => o.id)), { record: true });
    setSelectedIds(new Set());
  }

  function discard() {
    if (!window.confirm("保存していない変更を破棄します。よろしいですか?")) return;
    reset(saved ?? initial);
    setSelectedIds(new Set());
  }

  async function save() {
    const payload = { ward_location_id: wardId, ward_name: wardName || null, layout };
    const result = mapId
      ? await mutations.update.mutateAsync({ id: mapId, payload })
      : await mutations.create.mutateAsync(payload);
    setMapId(result.id);
    setSaved(layout);
  }

  // ---- キーボード ----

  useEffect(() => {
    function isTyping(target: EventTarget | null) {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return (
        element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA" ||
        element.tagName === "SELECT" ||
        element.isContentEditable
      );
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (isTyping(event.target)) return;
      if (event.key === " ") {
        spaceHeld.current = true;
        event.preventDefault();
        return;
      }
      const meta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (meta && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (meta && key === "d") {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (selectedIds.size === 0) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
        return;
      }
      if (event.key === "Escape") {
        setSelectedIds(new Set());
        return;
      }
      if (key === "r" && !meta) {
        rotateSelected();
        return;
      }
      const step = event.shiftKey ? 5 : 1;
      const arrows: Record<string, [number, number]> = {
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
      };
      const delta = arrows[event.key];
      if (!delta) return;
      event.preventDefault();
      set((current) => moveObjects(current, selectedIds, delta[0], delta[1]), { record: true });
    }
    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === " ") spaceHeld.current = false;
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [duplicateSelected, redo, removeSelected, rotateSelected, selectedIds, set, undo]);

  // 保存していない変更があるときは、タブを閉じる・リロードする前に止める。
  // (画面内の遷移は BrowserRouter なので止められない。)
  useEffect(() => {
    if (!dirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  // ---- 描画 ----

  const roomObjectsByLocation = useMemo(() => {
    const result = new Map<string, WardMapObject>();
    for (const object of layout.objects) if (object.type === "room") result.set(object.location_id, object);
    return result;
  }, [layout.objects]);

  function renderBed(object: BedObject, bed: fhir4.Location | undefined, room: fhir4.Location | undefined) {
    const roomObject = roomObjectsByLocation.get(object.room_id);
    const inside =
      roomObject &&
      object.x >= roomObject.x &&
      object.y >= roomObject.y &&
      object.x + object.w <= roomObject.x + roomObject.w &&
      object.y + object.h <= roomObject.y + roomObject.h;
    const classes = [
      "ward-map__bed",
      "ward-map__bed--edit",
      bed ? "" : "ward-map__bed--stale",
      inside ? "" : "ward-map__bed--outside",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div className={classes}>
        <div className="ward-map__bed-head">
          <span className="ward-map__bed-no">{bed ? bedShortLabel(bed) : "?"}</span>
        </div>
        <div className="ward-map__bed-empty">{bed ? "ベッド" : "削除されたベッド"}</div>
        <span className="ward-map__bed-room" aria-hidden="true">
          {room ? locationDisplayName(room) : ""}
        </span>
      </div>
    );
  }

  const gridSize = layout.grid_size;

  return (
    <>
      <ErrorBanner error={mutations.create.error} />
      <ErrorBanner error={mutations.update.error} />

      <div className="ward-map-edit__toolbar">
        <span className="ward-map-edit__ward">{wardName || "病棟マップ編集"}</span>
        <button type="button" onClick={save} disabled={saving || (!dirty && mapId !== null)}>
          {saving ? "保存中..." : "保存"}
        </button>
        <button type="button" onClick={discard} disabled={!dirty || saving}>
          破棄
        </button>
        <span className="ward-map-edit__toolbar-group" role="group" aria-label="履歴">
          <button type="button" onClick={undo} disabled={!history.canUndo} aria-label="元に戻す" title="元に戻す (Ctrl+Z)">
            ↶
          </button>
          <button type="button" onClick={redo} disabled={!history.canRedo} aria-label="やり直す" title="やり直す (Ctrl+Y)">
            ↷
          </button>
        </span>
        <button type="button" onClick={autoLayout}>
          自動配置
        </button>
        <button type="button" onClick={arrangeRooms}>
          {selectedIds.size > 0 && selected.some((o) => o.type === "room") ? "選んだ病室を整列" : "全病室を整列"}
        </button>
        <span className="ward-map-edit__toolbar-group" role="group" aria-label="表示倍率">
          <button type="button" onClick={viewport.zoomOut} disabled={!viewport.canZoomOut} aria-label="縮小">
            −
          </button>
          <button type="button" onClick={viewport.resetZoom} title="100% に戻す">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={viewport.zoomIn} disabled={!viewport.canZoomIn} aria-label="拡大">
            ＋
          </button>
          <button type="button" onClick={() => viewport.fitToWidth(layout.canvas.width * gridSize)}>
            幅に合わせる
          </button>
        </span>
        {dirty && <span className="ward-map-edit__dirty">未保存の変更があります</span>}
        <Link className="button ward-map-edit__toolbar-link" to={`/ward-map?ward=${wardId}`}>
          マップを見る
        </Link>
      </div>

      <div className="ward-map-edit__body">
        <WardMapEditorPalette
          unplaced={unplaced}
          staleCount={stale.length}
          onPointerDown={handlePalettePointerDown}
          onClick={handlePaletteClick}
          onRemoveStale={removeStale}
        />

        <div
          ref={scrollRef}
          className={`ward-map__scroll ward-map-edit__scroll${drag?.item.kind === "pan" ? " is-panning" : ""}`}
        >
          <WardMapCanvas
            layout={layout}
            grid={grid}
            zoom={zoom}
            canvasRef={canvasRef}
            renderBed={renderBed}
            selectedIds={selectedIds}
            onPointerDown={handleCanvasPointerDown}
            className={drag?.item.kind === "move" || drag?.item.kind === "resize" ? "is-dragging" : ""}
          >
            {selected.map((object) => (
              <div key={object.id} className="ward-map-edit__selection" style={objectStyle(object, gridSize)}>
                {selected.length === 1 &&
                  canResize(object) &&
                  RESIZE_EDGES.map((edge) => (
                    <span
                      key={edge}
                      className={`ward-map-edit__handle ward-map-edit__handle--${edge}`}
                      onPointerDown={(event) => handleHandlePointerDown(event, object.id, edge)}
                    />
                  ))}
              </div>
            ))}
            {addPreview && (
              <div
                className="ward-map-edit__preview"
                style={{
                  left: addPreview.x * gridSize,
                  top: addPreview.y * gridSize,
                  width: addPreview.w * gridSize,
                  height: addPreview.h * gridSize,
                }}
              />
            )}
          </WardMapCanvas>
        </div>

        <WardMapEditorProperties
          layout={layout}
          grid={grid}
          selected={selected}
          onCanvasChange={(width, height) => {
            const next = resizeCanvas(layout, width, height);
            if (!next) return false;
            set(next, { record: true });
            return true;
          }}
          onGridSizeChange={(gridSizeValue) => set(setGridSize(layout, gridSizeValue), { record: true })}
          onObjectChange={(id, patch) => set(updateObject(layout, id, patch), { record: true })}
          onRotate={rotateSelected}
          onDuplicate={duplicateSelected}
          onRemove={removeSelected}
          onArrange={arrangeRooms}
        />
      </div>
    </>
  );
}
