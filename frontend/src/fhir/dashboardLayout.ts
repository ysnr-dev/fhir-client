// ダッシュボードのレイアウト(docs/dashboard-design.md §3)。横 12 列・縦は 1 マスの高さのマス目にタイルを置く。
// 形の検証は backend(Dashboard::DEFINITION_SHAPE)。ここは画面の操作(動かす・大きさを変える・足す)を
// 純粋関数で持ち、重なりは動かしたタイルを優先して、ぶつかるタイルを下へ押し出す。

export type DashboardView = "count" | "breakdown" | "list";

export interface DashboardTile {
  id: string;
  /** データ抽出の保存した条件の code(環境をまたいでも同じ条件を指す)。 */
  query_code: string;
  view: DashboardView;
  /** 無ければ条件の名前を出す。 */
  title?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardBody {
  schema_version: 1;
  tiles: DashboardTile[];
}

export const DASHBOARD_COLUMNS = 12;
export const DASHBOARD_MAX_TILES = 40;
export const DASHBOARD_MAX_ROWS = 200;

export const DASHBOARD_VIEWS: { value: DashboardView; label: string }[] = [
  { value: "count", label: "件数" },
  { value: "breakdown", label: "内訳" },
  { value: "list", label: "一覧" },
];

export function dashboardViewLabel(view: DashboardView): string {
  return DASHBOARD_VIEWS.find((v) => v.value === view)?.label ?? view;
}

export function emptyDashboard(): DashboardBody {
  return { schema_version: 1, tiles: [] };
}

/** 表示ごとの既定の大きさ(列 × 行)。 */
export function defaultTileSize(view: DashboardView): { w: number; h: number } {
  if (view === "count") return { w: 3, h: 2 };
  if (view === "breakdown") return { w: 6, h: 5 };
  return { w: DASHBOARD_COLUMNS, h: 6 };
}

export function newTileId(tiles: DashboardTile[]): string {
  const max = tiles.reduce((acc, tile) => {
    const n = /^t(\d+)$/.exec(tile.id);
    return n ? Math.max(acc, Number(n[1])) : acc;
  }, 0);
  return `t${max + 1}`;
}

export function tilesOverlap(a: DashboardTile, b: DashboardTile): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** マス目に収める(右端をはみ出したら左へ寄せ、大きすぎれば縮める)。 */
export function clampTile(tile: DashboardTile): DashboardTile {
  const w = Math.min(Math.max(1, Math.round(tile.w)), DASHBOARD_COLUMNS);
  const h = Math.min(Math.max(1, Math.round(tile.h)), DASHBOARD_MAX_ROWS);
  const x = Math.min(Math.max(0, Math.round(tile.x)), DASHBOARD_COLUMNS - w);
  const y = Math.min(Math.max(0, Math.round(tile.y)), DASHBOARD_MAX_ROWS - h);
  return x === tile.x && y === tile.y && w === tile.w && h === tile.h ? tile : { ...tile, x, y, w, h };
}

/**
 * 重なりを解く。priorityId のタイルはそのままにし、ほかは上から順に、置いたタイルとぶつからない行まで
 * 下へずらす。並び(配列の順)は変えない。
 */
export function settleTiles(tiles: DashboardTile[], priorityId?: string): DashboardTile[] {
  const order = [...tiles].sort((a, b) => {
    if (a.id === priorityId) return -1;
    if (b.id === priorityId) return 1;
    return a.y - b.y || a.x - b.x;
  });
  const placed: DashboardTile[] = [];
  const moved = new Map<string, DashboardTile>();
  for (const tile of order) {
    let current = tile;
    while (placed.some((other) => tilesOverlap(current, other))) {
      current = { ...current, y: current.y + 1 };
    }
    placed.push(current);
    moved.set(current.id, current);
  }
  const next = tiles.map((tile) => moved.get(tile.id) ?? tile);
  return next.every((tile, i) => tile === tiles[i]) ? tiles : next;
}

/** 空いている最初の位置(上の行から左へ詰める)。 */
export function placeTile(tiles: DashboardTile[], size: { w: number; h: number }): { x: number; y: number } {
  const bottom = tiles.reduce((acc, tile) => Math.max(acc, tile.y + tile.h), 0);
  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x + size.w <= DASHBOARD_COLUMNS; x += 1) {
      const candidate: DashboardTile = { id: "", query_code: "", view: "count", x, y, ...size };
      if (!tiles.some((tile) => tilesOverlap(candidate, tile))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

export function addTile(
  tiles: DashboardTile[],
  tile: Omit<DashboardTile, "id" | "x" | "y" | "w" | "h"> & Partial<Pick<DashboardTile, "w" | "h">>,
): DashboardTile[] {
  const size = { ...defaultTileSize(tile.view), ...(tile.w && tile.h ? { w: tile.w, h: tile.h } : {}) };
  const at = placeTile(tiles, size);
  return [...tiles, clampTile({ ...tile, id: newTileId(tiles), ...at, ...size })];
}

export function removeTile(tiles: DashboardTile[], id: string): DashboardTile[] {
  return tiles.filter((tile) => tile.id !== id);
}

export function updateTile(tiles: DashboardTile[], id: string, patch: Partial<DashboardTile>): DashboardTile[] {
  return tiles.map((tile) => (tile.id === id ? clampTile({ ...tile, ...patch }) : tile));
}

/** タイルを dx 列・dy 行だけ動かす(掴んで動かす途中にも呼ぶので、base は掴む前の並び)。 */
export function moveTile(base: DashboardTile[], id: string, dx: number, dy: number): DashboardTile[] {
  const tile = base.find((t) => t.id === id);
  if (!tile) return base;
  const moved = clampTile({ ...tile, x: tile.x + dx, y: tile.y + dy });
  return settleTiles(
    base.map((t) => (t.id === id ? moved : t)),
    id,
  );
}

/** タイルの右下の角を dx 列・dy 行だけ動かして大きさを変える。 */
export function resizeTile(base: DashboardTile[], id: string, dx: number, dy: number): DashboardTile[] {
  const tile = base.find((t) => t.id === id);
  if (!tile) return base;
  const resized = clampTile({ ...tile, w: tile.w + dx, h: tile.h + dy });
  return settleTiles(
    base.map((t) => (t.id === id ? resized : t)),
    id,
  );
}

/** 保存した並びを画面用に整える(マス目に収め、重なりを解く)。 */
export function normalizeDashboard(body: DashboardBody): DashboardBody {
  const tiles = settleTiles(body.tiles.map(clampTile));
  return tiles === body.tiles ? body : { ...body, tiles };
}
