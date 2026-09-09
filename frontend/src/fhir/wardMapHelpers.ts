// 病棟マップのレイアウト(設備・病室・ベッドの配置)の型と純粋関数。
//
// レイアウトは backend の master_ward_maps に 1 病棟 1 行の jsonb で持つ
// (Master::WardMap の layout_shape と同じ形)。座標と大きさはすべてグリッドの
// マス数(整数)。px への換算は grid_size を掛けるだけで、描画側が担う。
//
// 病室・ベッドは FHIR Location の id で参照し、名前は持たない(表示時に Location から
// 出す)。ベッドが何床あるかは Location だけが正で、ここは「どこに描くか」しか持たない。
// Location が消えたオブジェクトは欠番(stale)として扱い、エディタでまとめて除ける。

export const WARD_MAP_SCHEMA_VERSION = 1;
/** 1 マスの px。既定値で、レイアウトごとに変えられる。 */
export const DEFAULT_GRID_SIZE = 20;
/** キャンバスの既定の大きさ(マス数)。 */
export const DEFAULT_CANVAS = { width: 60, height: 40 };
/** ベッドの大きさ(マス数)。患者情報を載せるので固定にする(回転で縦横が入れ替わる)。 */
export const BED_SIZE = { w: 6, h: 6 } as const;
/** 病室の最小の大きさ。上 1 マスは病室名の帯。 */
export const MIN_ROOM_SIZE = { w: BED_SIZE.w + 2, h: BED_SIZE.h + 2 };
export const CANVAS_LIMITS = { min: 10, max: 400 };
export const GRID_SIZE_LIMITS = { min: 12, max: 48 };
export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/** 設備の種別。表示名と置いたときの既定の大きさ。 */
export const FIXTURE_KINDS = [
  { kind: "nurse_station", label: "ナースステーション", w: 8, h: 4 },
  { kind: "toilet", label: "トイレ", w: 3, h: 3 },
  { kind: "bath", label: "浴室", w: 4, h: 3 },
  { kind: "stairs", label: "階段", w: 3, h: 4 },
  { kind: "elevator", label: "エレベーター", w: 3, h: 3 },
  { kind: "corridor", label: "廊下", w: 20, h: 2 },
  { kind: "wall", label: "壁", w: 10, h: 1 },
  { kind: "door", label: "扉", w: 2, h: 1 },
  { kind: "treatment", label: "処置室", w: 6, h: 4 },
  { kind: "dayroom", label: "デイルーム", w: 6, h: 4 },
  { kind: "label", label: "ラベル", w: 6, h: 1 },
  { kind: "area", label: "区画", w: 6, h: 4 },
] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number]["kind"];

interface WardMapObjectBase {
  /** クライアントで採番する UUID。 */
  id: string;
  /** 左上の位置(マス)。 */
  x: number;
  y: number;
  /** 大きさ(マス)。 */
  w: number;
  h: number;
}

export interface FixtureObject extends WardMapObjectBase {
  type: "fixture";
  kind: FixtureKind;
  /** 任意の表示名。空なら種別の名前を出す。 */
  label?: string;
  rotation: Rotation;
  /** "#rrggbb"。未指定なら種別ごとの既定色。 */
  color?: string;
}

export interface RoomObject extends WardMapObjectBase {
  type: "room";
  /** 病室の Location.id。 */
  location_id: string;
}

export interface BedObject extends WardMapObjectBase {
  type: "bed";
  /** ベッドの Location.id。 */
  location_id: string;
  /** 所属する病室の Location.id(partOf の写し)。整列と未配置の判定に使う。 */
  room_id: string;
  rotation: Rotation;
}

export type WardMapObject = FixtureObject | RoomObject | BedObject;

export interface WardMapLayout {
  schema_version: number;
  /** キャンバスの大きさ(マス数)。 */
  canvas: { width: number; height: number };
  /** 1 マスの px。 */
  grid_size: number;
  objects: WardMapObject[];
}

/** useWardGrid が返す形。api 層に依存しないよう構造で受ける。 */
export interface WardGridLike {
  rooms: fhir4.Location[];
  bedsByRoom: Map<string, fhir4.Location[]>;
}

export function fixtureKindDef(kind: FixtureKind) {
  return FIXTURE_KINDS.find((def) => def.kind === kind) ?? FIXTURE_KINDS[0];
}

export function fixtureLabel(object: FixtureObject): string {
  return object.label?.trim() || fixtureKindDef(object.kind).label;
}

export function emptyLayout(): WardMapLayout {
  return {
    schema_version: WARD_MAP_SCHEMA_VERSION,
    canvas: { ...DEFAULT_CANVAS },
    grid_size: DEFAULT_GRID_SIZE,
    objects: [],
  };
}

function newId(): string {
  return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toRotation(value: unknown): Rotation {
  return (ROTATIONS as readonly number[]).includes(value as number) ? (value as Rotation) : 0;
}

/** ベッドの大きさ。回転で縦横が入れ替わる。 */
export function bedSize(rotation: Rotation): { w: number; h: number } {
  return rotation === 90 || rotation === 270
    ? { w: BED_SIZE.h, h: BED_SIZE.w }
    : { w: BED_SIZE.w, h: BED_SIZE.h };
}

/**
 * backend から来た JSON を型に寄せる。欠けたキーは既定値で埋め、ベッドの大きさは
 * 固定値に矯正する。壊れたオブジェクトは捨てる(描けないものを残しても直せない)。
 */
export function normalizeLayout(raw: unknown): WardMapLayout {
  const base = emptyLayout();
  if (!isRecord(raw)) return base;

  const canvasRaw = isRecord(raw.canvas) ? raw.canvas : {};
  const canvas = {
    width: clampInt(toInt(canvasRaw.width, base.canvas.width), CANVAS_LIMITS.min, CANVAS_LIMITS.max),
    height: clampInt(toInt(canvasRaw.height, base.canvas.height), CANVAS_LIMITS.min, CANVAS_LIMITS.max),
  };
  const grid_size = clampInt(toInt(raw.grid_size, base.grid_size), GRID_SIZE_LIMITS.min, GRID_SIZE_LIMITS.max);

  const objects: WardMapObject[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.objects) ? raw.objects : []) {
    const object = normalizeObject(item);
    if (!object || seen.has(object.id)) continue;
    seen.add(object.id);
    objects.push(clampObject(object, canvas));
  }

  return { schema_version: WARD_MAP_SCHEMA_VERSION, canvas, grid_size, objects };
}

function normalizeObject(raw: unknown): WardMapObject | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : newId();
  const x = Math.max(0, toInt(raw.x, 0));
  const y = Math.max(0, toInt(raw.y, 0));
  const w = Math.max(1, toInt(raw.w, 1));
  const h = Math.max(1, toInt(raw.h, 1));

  switch (raw.type) {
    case "fixture": {
      const kind = FIXTURE_KINDS.some((def) => def.kind === raw.kind)
        ? (raw.kind as FixtureKind)
        : null;
      if (!kind) return null;
      const object: FixtureObject = { id, type: "fixture", kind, x, y, w, h, rotation: toRotation(raw.rotation) };
      if (typeof raw.label === "string" && raw.label) object.label = raw.label;
      if (typeof raw.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color)) object.color = raw.color;
      return object;
    }
    case "room":
      if (typeof raw.location_id !== "string" || !raw.location_id) return null;
      return { id, type: "room", location_id: raw.location_id, x, y, w, h };
    case "bed": {
      if (typeof raw.location_id !== "string" || !raw.location_id) return null;
      if (typeof raw.room_id !== "string" || !raw.room_id) return null;
      const rotation = toRotation(raw.rotation);
      return { id, type: "bed", location_id: raw.location_id, room_id: raw.room_id, x, y, rotation, ...bedSize(rotation) };
    }
    default:
      return null;
  }
}

/** キャンバスの中に収める。大きさがキャンバスを超えるときは大きさも詰める。 */
export function clampObject<T extends WardMapObject>(object: T, canvas: WardMapLayout["canvas"]): T {
  const w = Math.min(object.w, canvas.width);
  const h = Math.min(object.h, canvas.height);
  const x = clampInt(object.x, 0, canvas.width - w);
  const y = clampInt(object.y, 0, canvas.height - h);
  if (x === object.x && y === object.y && w === object.w && h === object.h) return object;
  return { ...object, x, y, w, h };
}

// ---- 自動配置 ----

/** 病室の中でベッドを並べたときの大きさ(列数は幅の上限から決める)。 */
function roomSizeForBeds(bedCount: number, maxWidth: number) {
  const perRow = Math.max(1, Math.floor((maxWidth - 1) / (BED_SIZE.w + 1)));
  const columns = Math.min(Math.max(bedCount, 1), perRow);
  const rows = Math.max(1, Math.ceil(bedCount / perRow));
  return {
    w: Math.max(columns * (BED_SIZE.w + 1) + 1, MIN_ROOM_SIZE.w),
    h: 1 + rows * (BED_SIZE.h + 1),
    perRow,
  };
}

function placeBedsInRoom(room: RoomObject, beds: fhir4.Location[], perRow: number): BedObject[] {
  return beds.map((bed, index) => ({
    id: newId(),
    type: "bed",
    location_id: bed.id ?? "",
    room_id: room.location_id,
    x: room.x + 1 + (index % perRow) * (BED_SIZE.w + 1),
    y: room.y + 1 + Math.floor(index / perRow) * (BED_SIZE.h + 1),
    rotation: 0,
    ...bedSize(0),
  }));
}

/**
 * 病室とベッドを機械的に並べた初期レイアウト。病室を名前順に左から右へ、幅を超えたら
 * 次の段へ。ベッドは病室の中に横並び。設備は置かない(間取りは施設ごとに違う)。
 * 高さが足りなければキャンバスを伸ばす。
 */
export function buildInitialLayout(grid: WardGridLike, canvasWidth = DEFAULT_CANVAS.width): WardMapLayout {
  const layout = emptyLayout();
  layout.canvas.width = canvasWidth;
  const gap = 1;
  let x = gap;
  let y = gap;
  let rowHeight = 0;

  for (const room of grid.rooms) {
    if (!room.id) continue;
    const beds = grid.bedsByRoom.get(room.id) ?? [];
    const size = roomSizeForBeds(beds.length, canvasWidth - gap * 2);
    if (x + size.w > canvasWidth - gap && x > gap) {
      x = gap;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    const roomObject: RoomObject = { id: newId(), type: "room", location_id: room.id, x, y, w: size.w, h: size.h };
    layout.objects.push(roomObject, ...placeBedsInRoom(roomObject, beds, size.perRow));
    x += size.w + gap;
    rowHeight = Math.max(rowHeight, size.h);
  }

  layout.canvas.height = clampInt(
    Math.max(DEFAULT_CANVAS.height, y + rowHeight + gap),
    CANVAS_LIMITS.min,
    CANVAS_LIMITS.max,
  );
  return layout;
}

export function bedObjectsInRoom(layout: WardMapLayout, roomLocationId: string): BedObject[] {
  return layout.objects.filter(
    (object): object is BedObject => object.type === "bed" && object.room_id === roomLocationId,
  );
}

/**
 * 病室内のベッドを並べ直す(手で崩したものを整える)。Location にあるベッドで、
 * まだ置いていないものも一緒に置く。病室が狭ければ広げる。
 */
export function arrangeBedsInRoom(layout: WardMapLayout, roomObject: RoomObject, grid: WardGridLike): WardMapLayout {
  const beds = grid.bedsByRoom.get(roomObject.location_id) ?? [];
  const size = roomSizeForBeds(beds.length, layout.canvas.width - roomObject.x - 1);
  const room: RoomObject = { ...roomObject, w: Math.max(roomObject.w, size.w), h: Math.max(roomObject.h, size.h) };
  const existing = new Map(bedObjectsInRoom(layout, room.location_id).map((bed) => [bed.location_id, bed]));
  const arranged = placeBedsInRoom(room, beds, size.perRow).map((bed) => {
    const before = existing.get(bed.location_id);
    return before ? { ...bed, id: before.id } : bed;
  });
  const objects = layout.objects
    .filter((object) => !(object.type === "bed" && object.room_id === room.location_id))
    .map((object) => (object.id === room.id ? room : object));
  return { ...layout, objects: [...objects, ...arranged].map((object) => clampObject(object, layout.canvas)) };
}

// ---- Location との突き合わせ ----

export interface UnplacedLocations {
  rooms: fhir4.Location[];
  beds: { bed: fhir4.Location; room: fhir4.Location }[];
}

/** Location にあってレイアウトに無い病室・ベッド。パレットの「未配置」に並べる。 */
export function unplacedLocations(layout: WardMapLayout, grid: WardGridLike): UnplacedLocations {
  const placedRooms = new Set(layout.objects.filter((o) => o.type === "room").map((o) => o.location_id));
  const placedBeds = new Set(layout.objects.filter((o) => o.type === "bed").map((o) => o.location_id));
  const rooms = grid.rooms.filter((room) => room.id && !placedRooms.has(room.id));
  const beds = grid.rooms.flatMap((room) =>
    (grid.bedsByRoom.get(room.id ?? "") ?? [])
      .filter((bed) => bed.id && !placedBeds.has(bed.id))
      .map((bed) => ({ bed, room })),
  );
  return { rooms, beds };
}

/** レイアウトにあって Location には無い(消された)病室・ベッド。 */
export function staleObjects(layout: WardMapLayout, grid: WardGridLike): (RoomObject | BedObject)[] {
  const roomIds = new Set(grid.rooms.map((room) => room.id));
  const bedIds = new Set([...grid.bedsByRoom.values()].flat().map((bed) => bed.id));
  return layout.objects.filter(
    (object): object is RoomObject | BedObject =>
      (object.type === "room" && !roomIds.has(object.location_id)) ||
      (object.type === "bed" && !bedIds.has(object.location_id)),
  );
}

export function removeObjects(layout: WardMapLayout, ids: Iterable<string>): WardMapLayout {
  const set = new Set(ids);
  return { ...layout, objects: layout.objects.filter((object) => !set.has(object.id)) };
}

/** 病室のオブジェクトを消すときに一緒に消えるベッドを含めた id。 */
export function idsWithRoomBeds(layout: WardMapLayout, ids: Iterable<string>): Set<string> {
  const set = new Set(ids);
  for (const object of layout.objects) {
    if (object.type !== "room" || !set.has(object.id)) continue;
    for (const bed of bedObjectsInRoom(layout, object.location_id)) set.add(bed.id);
  }
  return set;
}

// ---- 編集操作 ----

/**
 * まとめて動かす。病室を動かすと中のベッドも一緒に動く。全員がキャンバスに収まる
 * 範囲まで移動量を詰める(1 つだけ壁に当たって形が崩れないように)。
 */
export function moveObjects(layout: WardMapLayout, ids: Iterable<string>, dx: number, dy: number): WardMapLayout {
  const set = idsWithRoomBeds(layout, ids);
  const moving = layout.objects.filter((object) => set.has(object.id));
  if (moving.length === 0 || (dx === 0 && dy === 0)) return layout;

  let minDx = -Infinity;
  let maxDx = Infinity;
  let minDy = -Infinity;
  let maxDy = Infinity;
  for (const object of moving) {
    minDx = Math.max(minDx, -object.x);
    maxDx = Math.min(maxDx, layout.canvas.width - object.w - object.x);
    minDy = Math.max(minDy, -object.y);
    maxDy = Math.min(maxDy, layout.canvas.height - object.h - object.y);
  }
  const shiftX = clampInt(dx, minDx, maxDx);
  const shiftY = clampInt(dy, minDy, maxDy);
  if (shiftX === 0 && shiftY === 0) return layout;

  return {
    ...layout,
    objects: layout.objects.map((object) =>
      set.has(object.id) ? { ...object, x: object.x + shiftX, y: object.y + shiftY } : object,
    ),
  };
}

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function canResize(object: WardMapObject): boolean {
  return object.type !== "bed";
}

/**
 * 縁を掴んで大きさを変える。ベッドは固定。病室は中のベッドがはみ出さない範囲まで。
 */
export function resizeObject(
  layout: WardMapLayout,
  id: string,
  edge: ResizeEdge,
  dx: number,
  dy: number,
): WardMapLayout {
  const object = layout.objects.find((o) => o.id === id);
  if (!object || !canResize(object)) return layout;

  let left = object.x;
  let top = object.y;
  let right = object.x + object.w;
  let bottom = object.y + object.h;
  if (edge.includes("e")) right += dx;
  if (edge.includes("s")) bottom += dy;
  if (edge.includes("w")) left += dx;
  if (edge.includes("n")) top += dy;

  // 病室は中のベッドの外側までしか寄せられない。
  if (object.type === "room") {
    for (const bed of bedObjectsInRoom(layout, object.location_id)) {
      if (edge.includes("w")) left = Math.min(left, bed.x);
      if (edge.includes("n")) top = Math.min(top, bed.y);
      if (edge.includes("e")) right = Math.max(right, bed.x + bed.w);
      if (edge.includes("s")) bottom = Math.max(bottom, bed.y + bed.h);
    }
  }

  right = clampInt(Math.max(right, left + 1), 1, layout.canvas.width);
  bottom = clampInt(Math.max(bottom, top + 1), 1, layout.canvas.height);
  left = clampInt(left, 0, right - 1);
  top = clampInt(top, 0, bottom - 1);

  const next = { ...object, x: left, y: top, w: right - left, h: bottom - top };
  if (next.x === object.x && next.y === object.y && next.w === object.w && next.h === object.h) return layout;
  return { ...layout, objects: layout.objects.map((o) => (o.id === id ? next : o)) };
}

/** 90° 回す。設備は縦横を入れ替え、ベッドは向きと大きさを入れ替える。病室は回さない。 */
export function rotateObject(layout: WardMapLayout, id: string): WardMapLayout {
  const object = layout.objects.find((o) => o.id === id);
  if (!object || object.type === "room") return layout;
  const rotation = ((object.rotation + 90) % 360) as Rotation;
  const rotated: WardMapObject =
    object.type === "bed"
      ? { ...object, rotation, ...bedSize(rotation) }
      : { ...object, rotation, w: object.h, h: object.w };
  return {
    ...layout,
    objects: layout.objects.map((o) => (o.id === id ? clampObject(rotated, layout.canvas) : o)),
  };
}

/** 設備だけを複製する(病室・ベッドは同じ場所を 2 つ置けない)。右下に 1 マスずらす。 */
export function duplicateObjects(
  layout: WardMapLayout,
  ids: Iterable<string>,
): { layout: WardMapLayout; ids: string[] } {
  const set = new Set(ids);
  const copies = layout.objects
    .filter((object): object is FixtureObject => object.type === "fixture" && set.has(object.id))
    .map((object) => clampObject({ ...object, id: newId(), x: object.x + 1, y: object.y + 1 }, layout.canvas));
  return { layout: { ...layout, objects: [...layout.objects, ...copies] }, ids: copies.map((c) => c.id) };
}

export function addFixture(
  layout: WardMapLayout,
  kind: FixtureKind,
  x: number,
  y: number,
): { layout: WardMapLayout; id: string } {
  const def = fixtureKindDef(kind);
  const object = clampObject<FixtureObject>(
    { id: newId(), type: "fixture", kind, x, y, w: def.w, h: def.h, rotation: 0 },
    layout.canvas,
  );
  return { layout: { ...layout, objects: [...layout.objects, object] }, id: object.id };
}

/** 病室を置く。中のベッドのうち未配置のものも一緒に並べる。 */
export function addRoom(
  layout: WardMapLayout,
  room: fhir4.Location,
  grid: WardGridLike,
  x: number,
  y: number,
): { layout: WardMapLayout; id: string } {
  const roomId = room.id ?? "";
  const beds = grid.bedsByRoom.get(roomId) ?? [];
  const size = roomSizeForBeds(beds.length, layout.canvas.width - x - 1);
  const roomObject = clampObject<RoomObject>(
    { id: newId(), type: "room", location_id: roomId, x, y, w: size.w, h: size.h },
    layout.canvas,
  );
  const placed = new Set(layout.objects.filter((o) => o.type === "bed").map((o) => o.location_id));
  const bedObjects = placeBedsInRoom(roomObject, beds, size.perRow).filter((bed) => !placed.has(bed.location_id));
  return {
    layout: { ...layout, objects: [...layout.objects, roomObject, ...bedObjects.map((b) => clampObject(b, layout.canvas))] },
    id: roomObject.id,
  };
}

export function addBed(
  layout: WardMapLayout,
  bed: fhir4.Location,
  roomLocationId: string,
  x: number,
  y: number,
): { layout: WardMapLayout; id: string } {
  const object = clampObject<BedObject>(
    { id: newId(), type: "bed", location_id: bed.id ?? "", room_id: roomLocationId, x, y, rotation: 0, ...bedSize(0) },
    layout.canvas,
  );
  return { layout: { ...layout, objects: [...layout.objects, object] }, id: object.id };
}

/** キャンバスの大きさを変える。はみ出すオブジェクトがあれば null(縮められない)。 */
export function resizeCanvas(layout: WardMapLayout, width: number, height: number): WardMapLayout | null {
  const canvas = {
    width: clampInt(width, CANVAS_LIMITS.min, CANVAS_LIMITS.max),
    height: clampInt(height, CANVAS_LIMITS.min, CANVAS_LIMITS.max),
  };
  const overflow = layout.objects.some((o) => o.x + o.w > canvas.width || o.y + o.h > canvas.height);
  if (overflow) return null;
  return { ...layout, canvas };
}

export function setGridSize(layout: WardMapLayout, gridSize: number): WardMapLayout {
  return { ...layout, grid_size: clampInt(Math.round(gridSize), GRID_SIZE_LIMITS.min, GRID_SIZE_LIMITS.max) };
}

export function updateObject<T extends WardMapObject>(
  layout: WardMapLayout,
  id: string,
  patch: Partial<T>,
): WardMapLayout {
  return {
    ...layout,
    objects: layout.objects.map((o) => (o.id === id ? clampObject({ ...o, ...patch } as WardMapObject, layout.canvas) : o)),
  };
}

// ---- 当たり判定・座標 ----

function contains(object: WardMapObject, gx: number, gy: number): boolean {
  return gx >= object.x && gx < object.x + object.w && gy >= object.y && gy < object.y + object.h;
}

const HIT_PRIORITY: Record<WardMapObject["type"], number> = { bed: 3, room: 2, fixture: 1 };

/**
 * マス座標にあるオブジェクト。ベッド > 病室 > 設備の順で優先し、同じ種類なら
 * 後に置いたもの(配列の後ろ = 手前に描かれる)を採る。病室の中を押せばベッド、
 * ベッドの無いところなら病室が選ばれる。
 */
export function hitTest(layout: WardMapLayout, gx: number, gy: number): WardMapObject | undefined {
  let found: WardMapObject | undefined;
  for (const object of layout.objects) {
    if (!contains(object, gx, gy)) continue;
    if (!found || HIT_PRIORITY[object.type] >= HIT_PRIORITY[found.type]) found = object;
  }
  return found;
}

export function hitTestBed(layout: WardMapLayout, gx: number, gy: number): BedObject | undefined {
  let found: BedObject | undefined;
  for (const object of layout.objects) {
    if (object.type === "bed" && contains(object, gx, gy)) found = object;
  }
  return found;
}

/**
 * client 座標をマス座標(小数)に直す。rect はキャンバス要素の getBoundingClientRect
 * (scale 込みの大きさが返る)。丸めは呼び出し側で(掴んだ位置のずれを保つため)。
 */
export function clientToGrid(
  rect: DOMRect,
  gridSize: number,
  zoom: number,
  clientX: number,
  clientY: number,
): { gx: number; gy: number } {
  const scale = gridSize * zoom;
  return { gx: (clientX - rect.left) / scale, gy: (clientY - rect.top) / scale };
}

/** px 差分をマス数に丸める(ドラッグの移動量)。 */
export function pxToCells(delta: number, gridSize: number, zoom: number): number {
  return Math.round(delta / (gridSize * zoom));
}

/** オブジェクトの位置と大きさ(px)。描画側の絶対配置に使う。 */
export function objectStyle(object: WardMapObject, gridSize: number) {
  return {
    left: object.x * gridSize,
    top: object.y * gridSize,
    width: object.w * gridSize,
    height: object.h * gridSize,
  };
}

/** パレットから置くものの種類。設備は種別、病室・ベッドは Location。 */
export type AddTemplate =
  | { type: "fixture"; kind: FixtureKind }
  | { type: "room"; room: fhir4.Location }
  | { type: "bed"; bed: fhir4.Location; room: fhir4.Location };

/** パレットの項目を置くときの大きさ(掴んでいる間の枠に使う)。 */
export function templateSize(template: AddTemplate): { w: number; h: number } {
  switch (template.type) {
    case "fixture": {
      const def = fixtureKindDef(template.kind);
      return { w: def.w, h: def.h };
    }
    case "room":
      return { w: MIN_ROOM_SIZE.w, h: MIN_ROOM_SIZE.h };
    case "bed":
      return { w: BED_SIZE.w, h: BED_SIZE.h };
  }
}
