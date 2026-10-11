import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { Dashboard } from "../api/masterClient";
import { useDashboardMutations, useDashboards, useExtractQueries, usePatientFolders } from "../api/masterQueries";
import { AddTileModal } from "../components/dashboard/AddTileModal";
import { DashboardTile } from "../components/dashboard/DashboardTile";
import { ErrorBanner } from "../components/ErrorBanner";
import { ExtractQuerySelect } from "../components/extract/ExtractQuerySelect";
import { SaveQueryModal } from "../components/extract/SaveQueryModal";
import { TrashIcon } from "../components/icons/TrashIcon";
import {
  DASHBOARD_COLUMNS,
  DASHBOARD_MAX_TILES,
  addTile,
  emptyDashboard,
  moveTile,
  normalizeDashboard,
  removeTile,
  resizeTile,
  type DashboardBody,
  type DashboardTile as Tile,
} from "../fhir/dashboardLayout";
import { stableJson } from "../fhir/extractRecordQuery";
import { useCardDrag } from "../hooks/useCardDrag";
import { useDashboardRun } from "../hooks/useDashboardRun";
import { definitionOwnerOf, useDefinitionOwners } from "../hooks/useDefinitionOwners";
import { useExtractRunContext } from "../hooks/useExtractRunContext";
import { useUndoableState } from "../hooks/useUndoableState";

// ダッシュボード(docs/dashboard-design.md)。データ抽出の保存した条件をタイルとして並べ、「実行」で
// 上から順に実行する。並べ方は持ち主(院内共通 / 診療科 / 自分 / チーム)ごとに名前を付けて保存する。
// 掴んで動かす・大きさを変える操作は useCardDrag(Pointer Events)で、途中経過はレイアウトに直接
// 反映し、離したときだけ取り消しの履歴に積む(病棟マップの編集と同じ)。

/** 1 行の高さと行間(px)。CSS の --dashboard-row / gap と合わせる。 */
const ROW_PX = 56;
const GAP_PX = 12;

type DragItem = { kind: "move" | "resize"; id: string };

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { owners, ready, departmentId, practitionerId, teamIds } = useDefinitionOwners("自分のダッシュボード");
  const list = useDashboards(departmentId, practitionerId, ready, teamIds);
  const dashboards = useMemo(() => list.data?.items ?? [], [list.data]);
  const mutations = useDashboardMutations();
  const queryList = useExtractQueries(departmentId, practitionerId, ready, "all", teamIds);
  const queries = useMemo(() => queryList.data?.items ?? [], [queryList.data]);
  const folderList = usePatientFolders(departmentId, practitionerId);
  const folders = useMemo(() => folderList.data?.items ?? [], [folderList.data]);
  const context = useExtractRunContext();
  const run = useDashboardRun(queries, folders, context);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const layout = useUndoableState<DashboardBody>(emptyDashboard());
  const [savedJson, setSavedJson] = useState(stableJson(emptyDashboard()));
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = dashboards.find((d) => d.id === selectedId) ?? null;
  const body = layout.present;
  const dirty = stableJson(body) !== savedJson;
  const canEditSelected = selected ? definitionOwnerOf(owners, selected)?.canEdit === true : false;
  const canSaveNew = owners.some((o) => o.canEdit);

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  function load(dashboard: Dashboard | null) {
    const next = dashboard ? normalizeDashboard(dashboard.definition) : emptyDashboard();
    layout.reset(next);
    setSavedJson(stableJson(dashboard ? dashboard.definition : next));
    setSelectedId(dashboard?.id ?? null);
    setEditing(!dashboard);
    run.reset();
    setSearchParams(dashboard ? { id: String(dashboard.id) } : {}, { replace: true });
  }

  // ?id=<id> で開いたら読み込む(実行はしない)。
  const idParam = Number(searchParams.get("id"));
  useEffect(() => {
    if (!idParam || selectedId === idParam) return;
    const found = dashboards.find((d) => d.id === idParam);
    if (found) load(found);
    // load は選択の切替でだけ呼ぶ(依存に入れると読込のたびに走る)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, dashboards]);

  function confirmDiscard(): boolean {
    return !dirty || window.confirm("編集中のダッシュボードを破棄しますか？");
  }

  async function handleOverwrite() {
    if (!selected) return;
    const saved = await mutations.update.mutateAsync({ id: selected.id, payload: { definition: body } });
    setSavedJson(stableJson(saved.definition));
    setEditing(false);
  }

  function handleDelete() {
    if (!selected || !window.confirm(`「${selected.name}」を削除しますか？`)) return;
    mutations.remove.mutate(selected.id, { onSuccess: () => load(null) });
  }

  // ---- 編集(掴んで動かす・大きさを変える) ----
  const gridRef = useRef<HTMLDivElement>(null);
  const dragBase = useRef<DashboardBody | null>(null);
  const lastDelta = useRef({ dx: 0, dy: 0 });
  const { drag, start } = useCardDrag<DragItem>({
    onDrop: () => {
      const base = dragBase.current;
      dragBase.current = null;
      if (base) layout.commit(base, layout.present);
    },
  });
  const layoutRef = useRef(body);
  layoutRef.current = body;
  const { set } = layout;

  useEffect(() => {
    if (!drag) {
      // 掴まずに離した(クリック)か Escape で取りやめたときは、掴む前の形に戻す。
      if (dragBase.current) set(dragBase.current);
      dragBase.current = null;
      return;
    }
    const base = dragBase.current;
    const grid = gridRef.current;
    if (!base || !grid) return;
    const cell = (grid.getBoundingClientRect().width + GAP_PX) / DASHBOARD_COLUMNS;
    const dx = Math.round((drag.x - drag.startX) / cell);
    const dy = Math.round((drag.y - drag.startY) / (ROW_PX + GAP_PX));
    if (dx === lastDelta.current.dx && dy === lastDelta.current.dy) return;
    lastDelta.current = { dx, dy };
    const tiles =
      drag.item.kind === "move" ? moveTile(base.tiles, drag.item.id, dx, dy) : resizeTile(base.tiles, drag.item.id, dx, dy);
    set({ ...base, tiles });
  }, [drag, set]);

  function beginDrag(item: DragItem, event: PointerEvent<HTMLElement>) {
    dragBase.current = layoutRef.current;
    lastDelta.current = { dx: 0, dy: 0 };
    start(item, event);
  }

  const setTiles = (tiles: Tile[]) => layout.set({ ...layoutRef.current, tiles }, { record: true });

  const mutationError = mutations.create.error ?? mutations.update.error ?? mutations.remove.error;

  return (
    <div className="page data-extract dashboard">
      <div className="page__header">
        <h1>ダッシュボード</h1>
      </div>
      <div className="data-extract__toolbar">
        <label className="extract-field extract-field--inline">
          ダッシュボード
          <ExtractQuerySelect
            queries={dashboards}
            value={selectedId}
            emptyLabel="新しいダッシュボード"
            teamLabel="チーム"
            onChange={(dashboard) => {
              if (!confirmDiscard()) return;
              load(dashboard);
            }}
          />
        </label>
        {dirty && <span className="data-extract__dirty">未保存</span>}
        {run.running ? (
          <button type="button" onClick={run.cancel}>
            中止
          </button>
        ) : (
          <button type="button" disabled={body.tiles.length === 0 || editing} onClick={() => void run.runTiles(body.tiles)}>
            実行
          </button>
        )}
        {run.running && <span className="order-select__muted">{`実行中(検索 ${run.requests} 回)`}</span>}
        {editing ? (
          <>
            <button type="button" disabled={body.tiles.length >= DASHBOARD_MAX_TILES} onClick={() => setAdding(true)}>
              タイル追加
            </button>
            <button type="button" className="rp-card__compact-button" disabled={!layout.canUndo} onClick={layout.undo}>
              元に戻す
            </button>
            <button type="button" className="rp-card__compact-button" disabled={!layout.canRedo} onClick={layout.redo}>
              やり直す
            </button>
            {selected && canEditSelected && (
              <button type="button" onClick={() => void handleOverwrite()} disabled={!dirty || mutations.update.isPending}>
                保存
              </button>
            )}
            {canSaveNew && (
              <button type="button" onClick={() => setSaving(true)}>
                {selected ? "別名保存" : "保存"}
              </button>
            )}
            <button type="button" onClick={() => setEditing(false)}>
              閉じる
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setEditing(true)}>
              編集
            </button>
            {selected && canEditSelected && (
              <button
                type="button"
                className="rp-card__icon-button"
                title="ダッシュボードを削除"
                aria-label="ダッシュボードを削除"
                onClick={handleDelete}
              >
                <TrashIcon />
              </button>
            )}
          </>
        )}
      </div>

      <ErrorBanner error={list.error ?? queryList.error ?? folderList.error ?? mutationError} />

      <div className={`dashboard__grid${editing ? " is-editing" : ""}`} ref={gridRef}>
        {body.tiles.map((tile) => (
          <DashboardTile
            key={tile.id}
            tile={tile}
            query={queries.find((q) => q.code === tile.query_code)}
            state={run.states[tile.id] ?? { running: false, ranAt: null, outcome: null }}
            editing={editing}
            onRun={() => void run.runTiles([tile])}
            onRemove={() => setTiles(removeTile(body.tiles, tile.id))}
            onMoveStart={(event) => beginDrag({ kind: "move", id: tile.id }, event)}
            onResizeStart={(event) => beginDrag({ kind: "resize", id: tile.id }, event)}
          />
        ))}
        {body.tiles.length === 0 && (
          <p className="dashboard__empty order-select__muted">
            {editing ? "「タイル追加」で保存した条件を置きます。" : "タイルはありません。「編集」で足します。"}
          </p>
        )}
      </div>

      {adding && (
        <AddTileModal
          queries={queries}
          onAdd={(tile) => {
            setTiles(addTile(body.tiles, tile));
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {saving && (
        <SaveQueryModal
          title="ダッシュボードを保存"
          owners={owners}
          initialName={selected ? `${selected.name}のコピー` : ""}
          pending={mutations.create.isPending}
          error={mutations.create.error}
          onClose={() => setSaving(false)}
          onSave={async (name, owner) => {
            const created = await mutations.create.mutateAsync({
              scope: owner.scope,
              owner_id: owner.ownerId,
              owner_name: owner.ownerName,
              name,
              definition: body,
            });
            setSaving(false);
            setSelectedId(created.id);
            setSavedJson(stableJson(created.definition));
            setEditing(false);
            setSearchParams({ id: String(created.id) }, { replace: true });
          }}
        />
      )}
    </div>
  );
}
