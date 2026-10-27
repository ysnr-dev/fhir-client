// 口腔診査(口腔状態スナップショット)の歯式図を PNG(data URL)に描く。様式の「画像」項目の初期値(%oralExamChart)に使い、
// 紙面の歯式図の欄に重ねて印字する。
//
// 並びは紙の歯式図(歯科疾患管理料の管理計画書など)と同じアーチ状: 上顎の弓形と下顎の弓形を上下に置き、患者の右を
// 画面の左にする。乳歯の弓形は永久歯の内側(記録があるときだけ)。歯は円で、中央が切端・咬合面、周りの 4 つの扇形が
// 頬側(唇側)・口蓋側(舌側)・近心・遠心(画面の歯式図 components/OralExamChart.tsx と同じ面の取り方)。
// 歯の色は基本状態、塗った面は現在歯の内容の歯面、外側の字は歯の番号、内側の字は歯科健診記号(健全歯の「／」は省く)と内容の略号、
// 同じブリッジ・連結冠の歯は実線、同じ有床義歯の歯は破線で結ぶ。中央に現在歯の本数を書く。
// 紙は白地なので色はテーマに依らず印刷用に固定する。
import {
  checkupSymbol,
  countTeeth,
  filledSurfaces,
  isDeciduous,
  isSupernumerary,
  recordsOfTooth,
  supernumeraryCode,
  toothAbbreviations,
  toothCategory,
  TOOTH_ROWS,
  type ToothCategory,
  type ToothDef,
  type ToothRecord,
} from "./oralExamHelpers";
import { prosthesisMarks } from "./oralExamProsthesisHelpers";

/** 画像の論理サイズ(px)。様式の欄(400×474px、150dpi)に合わせる。印字用に 2 倍の解像度で描く。 */
export const ORAL_EXAM_CHART_IMAGE = { width: 400, height: 480, scale: 2 } as const;

const INK = "#111111";
const MUTED = "#9ca3af";
const PAPER = "#ffffff";
const SUNKEN = "#e5e7eb";
const ACCENT = "#2563eb";
const WARNING = "#d97706";
const DANGER = "#dc2626";
const PROSTHETIC = "#0f766e";

/** 健全歯の歯科健診記号。図には書かない。 */
const SOUND_SYMBOL = "／";

const CATEGORY_COLORS: Record<ToothCategory | "none", string> = {
  sound: INK,
  present: INK,
  observe: WARNING,
  caution: WARNING,
  caries: DANGER,
  treated: ACCENT,
  prosthetic: PROSTHETIC,
  implant: PROSTHETIC,
  missing: INK,
  impacted: INK,
  unknown: INK,
  none: MUTED,
};

// ---- 配置(紙の歯式図の円の中心と半径。画像の論理 px) ----

/** 弓形の内側(口腔)の中心。字の内外と装置の線の寄せ方を決める。 */
const CAVITY = { x: 201, y: 244 };
/** 右側(画面の左)の永久歯の中心。index は正中からの位置 - 1(1 番→8 番)。左側は正中で折り返す。 */
const UPPER_RIGHT: [number, number][] = [[182, 42], [159, 50], [137, 63], [120, 83], [102, 108], [86, 136], [72, 168], [65, 210]];
const LOWER_RIGHT: [number, number][] = [[182, 443], [160, 438], [137, 427], [120, 405], [102, 379], [87, 351], [72, 316], [66, 278]];
const UPPER_RIGHT_DECIDUOUS: [number, number][] = [[185, 122], [169, 133], [156, 150], [145, 175], [136, 203]];
const LOWER_RIGHT_DECIDUOUS: [number, number][] = [[185, 365], [169, 357], [156, 337], [145, 312], [136, 282]];
/** 半径(正中からの位置 - 1)。臼歯ほど大きい。 */
const PERMANENT_RADIUS = [11, 11, 13, 15, 15, 18, 21, 21];
const DECIDUOUS_RADIUS = [10, 10, 13, 15, 15];

interface ArchTooth {
  def: ToothDef;
  cx: number;
  cy: number;
  r: number;
}

/** 行(TOOTH_ROWS)ごとの歯の配置。右側の座標を正中(CAVITY.x)で折り返して左側を作る。 */
function archRows(teeth: ToothRecord[]): ArchTooth[][] {
  const hasDeciduous = teeth.some((t) => isDeciduous(t.toothCode));
  const rows: ArchTooth[][] = [];
  for (const row of TOOTH_ROWS) {
    if (row.deciduous && !hasDeciduous) continue;
    const upper = row.key.startsWith("upper");
    const points = row.deciduous ? (upper ? UPPER_RIGHT_DECIDUOUS : LOWER_RIGHT_DECIDUOUS) : upper ? UPPER_RIGHT : LOWER_RIGHT;
    const radii = row.deciduous ? DECIDUOUS_RADIUS : PERMANENT_RADIUS;
    rows.push(
      row.teeth.map((def) => {
        const [x, y] = points[def.position - 1];
        return { def, cx: def.right ? x : 2 * CAVITY.x - x, cy: y, r: radii[def.position - 1] };
      }),
    );
  }
  return rows;
}

// ---- 描画 ----

type Sector = "top" | "bottom" | "left" | "right";
/** 扇形の角度(canvas は右が 0、下回りが正)。 */
const SECTOR_ANGLES: Record<Sector, [number, number]> = {
  right: [-Math.PI / 4, Math.PI / 4],
  bottom: [Math.PI / 4, (3 * Math.PI) / 4],
  left: [(3 * Math.PI) / 4, (5 * Math.PI) / 4],
  top: [(5 * Math.PI) / 4, (7 * Math.PI) / 4],
};

function sectorPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number, sector: Sector) {
  const [a1, a2] = SECTOR_ANGLES[sector];
  ctx.beginPath();
  ctx.arc(cx, cy, outer, a1, a2);
  ctx.arc(cx, cy, inner, a2, a1, true);
  ctx.closePath();
}

function drawTooth(ctx: CanvasRenderingContext2D, tooth: ArchTooth, color: string, category: ToothCategory | "none", surfaces: Set<string>) {
  const { def, cx, cy, r } = tooth;
  const inner = r * 0.45;
  const buccal: Sector = def.upper ? "top" : "bottom";
  const lingual: Sector = def.upper ? "bottom" : "top";
  const mesial: Sector = def.right ? "right" : "left";
  const distal: Sector = def.right ? "left" : "right";
  const faces: { item: string; sector: Sector }[] = [
    { item: "TP-14", sector: buccal },
    { item: "TP-15", sector: lingual },
    { item: "TP-16", sector: mesial },
    { item: "TP-17", sector: distal },
  ];
  const baseFill = category === "prosthetic" || category === "implant" || category === "unknown" ? SUNKEN : PAPER;
  ctx.save();
  ctx.lineWidth = category === "none" ? 0.8 : 1;
  ctx.strokeStyle = color;
  ctx.setLineDash(category === "none" ? [2, 2] : category === "impacted" ? [3, 2] : []);
  const paint = (item: string) => {
    ctx.fillStyle = baseFill;
    ctx.fill();
    if (surfaces.has(item)) {
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.stroke();
  };
  for (const face of faces) {
    sectorPath(ctx, cx, cy, r, inner, face.sector);
    paint(face.item);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  paint("TP-13");
  if (category === "missing") {
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    const d = r * 0.75;
    ctx.beginPath();
    ctx.moveTo(cx - d, cy - d);
    ctx.lineTo(cx + d, cy + d);
    ctx.moveTo(cx + d, cy - d);
    ctx.lineTo(cx - d, cy + d);
    ctx.stroke();
  }
  ctx.restore();
}

/** 歯の中心から口腔の中心へ向かう単位ベクトル(内向き)。 */
function inward(tooth: ArchTooth): { x: number; y: number } {
  const dx = CAVITY.x - tooth.cx;
  const dy = CAVITY.y - tooth.cy;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

/**
 * 歯の外側か内側に字を置く。歯の縁から gap 離れた点に、字の箱がその方向に広がるように寄せる
 * (左右に向くときは横に、上下に向くときは縦に離れる)。長い字は maxWidth に詰める。
 */
function textBeside(
  ctx: CanvasRenderingContext2D,
  s: string,
  tooth: ArchTooth,
  direction: { x: number; y: number },
  gap: number,
  size: number,
  color: string,
  maxWidth: number,
) {
  if (!s) return;
  ctx.font = `${size}px sans-serif`;
  const width = Math.min(ctx.measureText(s).width, maxWidth);
  const height = size;
  const px = tooth.cx + direction.x * (tooth.r + gap);
  const py = tooth.cy + direction.y * (tooth.r + gap);
  const x = px + (direction.x * width) / 2;
  const y = py + (direction.y * height) / 2;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y, maxWidth);
}

function label(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, align: CanvasTextAlign = "center") {
  ctx.fillStyle = INK;
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillText(s, x, y);
}

/**
 * 歯式図を PNG の data URL にする。ブラウザ以外(canvas が無い)では空文字。
 * examDate は左上に「口腔診査 YYYY/MM/DD」として入れる。
 */
export function drawOralExamChartImage(teeth: ToothRecord[], examDate: string): string {
  if (typeof document === "undefined") return "";
  const { width, height, scale } = ORAL_EXAM_CHART_IMAGE;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(scale, scale);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  label(ctx, examDate ? `口腔診査 ${examDate.replaceAll("-", "/")}` : "口腔診査", 4, 4, 10, "left");
  label(ctx, "上", CAVITY.x, 8, 10);
  label(ctx, "下", CAVITY.x, height - 16, 10);
  label(ctx, "右", 10, CAVITY.y - 6, 10);
  label(ctx, "左", width - 18, CAVITY.y - 6, 10);
  label(ctx, `（ ${countTeeth(teeth).present} ）本`, CAVITY.x, CAVITY.y - 7, 12);

  const rows = archRows(teeth);
  const devices = prosthesisMarks(teeth);
  const supernumeraries = new Set(teeth.filter((t) => isSupernumerary(t.toothCode)).map((t) => t.toothCode));

  for (const row of rows) {
    // 同じ装置の隣り合う歯を、歯の内側で線で結ぶ(ブリッジ・連結冠は実線、有床義歯は破線)。
    for (let i = 0; i + 1 < row.length; i += 1) {
      const a = row[i];
      const b = row[i + 1];
      const da = devices.get(a.def.code);
      const db = devices.get(b.def.code);
      const ia = inward(a);
      const ib = inward(b);
      const line = (offset: number, color: string, dash: number[]) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(a.cx + ia.x * (a.r + offset), a.cy + ia.y * (a.r + offset));
        ctx.lineTo(b.cx + ib.x * (b.r + offset), b.cy + ib.y * (b.r + offset));
        ctx.stroke();
        ctx.restore();
      };
      if (da?.bridge && db?.bridge) line(4, ACCENT, []);
      if (da?.denture && db?.denture) line(7, PROSTHETIC, [4, 3]);
    }

    for (const tooth of row) {
      const records = recordsOfTooth(teeth, tooth.def.code);
      const primary = records[0];
      const category: ToothCategory | "none" = primary ? toothCategory(primary.basic) : "none";
      const color = CATEGORY_COLORS[category];
      drawTooth(ctx, tooth, color, category, filledSurfaces(records));

      const inside = inward(tooth);
      const outside = { x: -inside.x, y: -inside.y };
      const extra = supernumeraries.has(supernumeraryCode(tooth.def.code)) ? "+" : "";
      textBeside(ctx, `${tooth.def.label}${extra}`, tooth, outside, 3, 9, INK, 40);

      // 内側に健診記号と略号(先頭の 1 つ)。長ければ詰める。装置の線がある歯は線の内側に置く。
      // 健全歯の「／」は書かない(白い円のままで健全とわかり、紙面がうるさくならない)。
      const abbreviation = toothAbbreviations(records)[0] ?? "";
      const checkup = primary ? checkupSymbol(primary.basic) : "";
      const symbol = checkup === SOUND_SYMBOL ? "" : checkup;
      const note = [symbol, abbreviation].filter(Boolean).join(" ");
      const device = devices.get(tooth.def.code);
      textBeside(ctx, note, tooth, inside, device?.bridge || device?.denture ? 14 : 8, 7.5, color, 40);

      const contents = records.reduce((n, r) => n + r.contents.length, 0);
      const badge = records.length > 1 ? String(records.length) : contents > 1 ? String(contents) : "";
      if (badge) label(ctx, badge, tooth.cx + tooth.r * 0.8, tooth.cy - tooth.r - 2, 7, "left");
    }
  }

  return canvas.toDataURL("image/png");
}
