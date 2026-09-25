import { median } from "../lib/stats";
import {
  CHOICE_LEVELS,
  adverseGradeLevel,
  choiceLevelOf,
  chartEventKindLabel,
  type ChartChoiceTrack,
  type ChartDrugTrack,
  type ChartEvent,
  type ChartItem,
  type ChartPoint,
  type ChartRange,
  type ChartStateEventKind,
  type ChartTrackRef,
} from "./chartDefinitionHelpers";
import { epochOf } from "./flowsheetEventHelpers";

// マルチチャートの「状態」。帯の行(選択肢の項目・追う薬剤・入院・化学療法のクール・有害事象)を
// 時刻で引けるようにした区間の並びで、ホバーのツールチップ(その時点の状態)、全レーンの網掛け、
// 層別の要約の「層」が同じものを読む。タブが既に持つ行から作るので取得は増えない。
// 設計は docs/patient-chart-design.md §6.1 / §8。

const DAY_MS = 86_400_000;

export interface ChartStateSpan {
  /** 区間の始まり(epoch)。 */
  start: number;
  /** 区間の終わり(epoch、この時刻を含まない)。 */
  end: number;
  /** 「NYHA II」「2.5mg/日」「入院」「mFOLFOX6 C3」「悪心 G2」。 */
  label: string;
  /** 層の並び(選択肢の添字・用量の昇順・Grade)。並びが無ければ -1。 */
  index: number;
  /** 0〜4 の濃さ。CSS の .patient-chart__level--N / .patient-chart__state--N と対。 */
  level: number;
}

export interface ChartStratum {
  index: number;
  label: string;
  level: number;
}

export interface ChartStateTrack {
  ref: ChartTrackRef;
  name: string;
  /** start 昇順。有害事象だけは重なることがある。 */
  spans: ChartStateSpan[];
  /** 層の並び(表の列・凡例の順)。 */
  strata: ChartStratum[];
  /** どの区間にも入らない時間の呼び名。選択肢の項目は記録前なので持たない。 */
  rest?: string;
}

interface BuildStateTracksInput {
  items: ChartItem[];
  choiceTracks: ChartChoiceTrack[];
  drugTracks: ChartDrugTrack[];
  events: ChartEvent[];
  range: ChartRange;
}

/** 状態として使える行すべて(帯に出ている順)。 */
export function buildStateTracks(input: BuildStateTracksInput): ChartStateTrack[] {
  const tracks: ChartStateTrack[] = [];
  const kinds = new Set(input.events.map((event) => event.kind));
  for (const kind of ["encounter", "chemo", "adverse"] as const) {
    if (kinds.has(kind)) tracks.push(eventStateTrack(kind, input.events));
  }
  for (const track of input.drugTracks) tracks.push(drugStateTrack(track));
  for (const track of input.choiceTracks) tracks.push(choiceStateTrack(track, input.range));
  return tracks;
}

export function findStateTrack(
  tracks: ChartStateTrack[],
  ref: ChartTrackRef | null | undefined,
): ChartStateTrack | undefined {
  if (!ref) return undefined;
  return tracks.find((track) => sameRef(track.ref, ref));
}

function sameRef(a: ChartTrackRef, b: ChartTrackRef): boolean {
  if (a.kind === "event" || b.kind === "event") {
    return a.kind === "event" && b.kind === "event" && a.event === b.event;
  }
  return a.kind === b.kind && a.key === b.key;
}

export function chartTrackRefLabel(ref: ChartTrackRef, tracks: ChartStateTrack[]): string {
  const track = findStateTrack(tracks, ref);
  if (track) return track.name;
  return ref.kind === "event" ? chartEventKindLabel(ref.event) : ref.key;
}

/** 時刻 t に掛かる区間。 */
export function stateSpansAt(track: ChartStateTrack, t: number): ChartStateSpan[] {
  return track.spans.filter((span) => span.start <= t && t < span.end);
}

/** 時刻 t の層。重なれば並びの大きい方(有害事象の最大 Grade)。どれにも入らなければ null。 */
export function stratumAt(track: ChartStateTrack, t: number): ChartStratum | null {
  const spans = stateSpansAt(track, t);
  if (spans.length === 0) return null;
  const top = spans.reduce((a, b) => (b.index > a.index ? b : a));
  return track.strata.find((stratum) => stratum.index === top.index) ?? null;
}

/**
 * ツールチップに添える、時刻 t に有効な状態の行。
 * 「入院中(12 日目)」「mFOLFOX6 第 3 クール」「ワーファリン 2.5mg/日」「NYHA II(12 日前)」「悪心 G2」。
 */
export function describeStatesAt(tracks: ChartStateTrack[], t: number): string[] {
  const lines: string[] = [];
  for (const track of tracks) {
    for (const span of stateSpansAt(track, t)) {
      const days = Math.floor((t - span.start) / DAY_MS);
      if (track.ref.kind === "event" && track.ref.event === "encounter") {
        lines.push(`入院中(${days + 1} 日目)`);
      } else if (track.ref.kind === "event" && track.ref.event === "chemo") {
        lines.push(span.label);
      } else if (track.ref.kind === "item") {
        lines.push(`${track.name} ${span.label}${days >= 1 ? `(${days} 日前)` : ""}`);
      } else {
        lines.push(`${track.name} ${span.label}`);
      }
    }
  }
  return lines;
}

// ---- 行ごとの区間 ----

function choiceStateTrack(track: ChartChoiceTrack, range: ChartRange): ChartStateTrack {
  const spans: ChartStateSpan[] = track.marks.map((mark, i) => ({
    start: mark.t,
    end: track.marks[i + 1]?.t ?? range.tMax + DAY_MS,
    label: mark.label,
    index: mark.index,
    level: mark.level,
  }));
  const strata: ChartStratum[] = track.options.map((option, index) => ({
    index,
    label: option.display,
    // 凡例の濃さは選択肢の並び順で決める(この患者に記録の無い選択肢も同じ段で見せる)。
    level: choiceLevelOf(index, track.options.length, track.nominal),
  }));
  // 選択肢に無いコードの記録は「その他」の層にまとめる。
  if (spans.some((span) => span.index < 0)) strata.push({ index: -1, label: "その他", level: 0 });
  return { ref: { kind: "item", key: track.key }, name: track.name, spans, strata };
}

function drugStateTrack(track: ChartDrugTrack): ChartStateTrack {
  // 層は用量ごと。含量で足し上げた 1 日量があれば昇順、無ければ出てきた順。
  const labels = new Map<string, { total?: number; unit?: string }>();
  for (const segment of track.segments) {
    if (!labels.has(segment.label)) {
      labels.set(segment.label, { total: segment.total?.value, unit: segment.total?.unit });
    }
  }
  const ordered = [...labels.entries()].sort((a, b) => {
    const ta = a[1].total;
    const tb = b[1].total;
    if (ta !== undefined && tb !== undefined && a[1].unit === b[1].unit) return ta - tb;
    return 0;
  });
  const strata: ChartStratum[] = ordered.map(([label], index) => ({
    index,
    label,
    level: levelOf(index, ordered.length),
  }));
  const indexOf = new Map(strata.map((stratum) => [stratum.label, stratum.index]));
  const spans: ChartStateSpan[] = track.segments.map((segment) => {
    const index = indexOf.get(segment.label) ?? -1;
    return {
      start: epochOf(segment.start),
      end: epochOf(segment.end) + DAY_MS,
      label: segment.label,
      index,
      level: levelOf(index, ordered.length),
    };
  });
  return { ref: { kind: "drug", key: track.key }, name: track.name, spans, strata, rest: "服用なし" };
}

function eventStateTrack(kind: ChartStateEventKind, events: ChartEvent[]): ChartStateTrack {
  const bars = events
    .filter((event) => event.kind === kind && event.end)
    .sort((a, b) => epochOf(a.at) - epochOf(b.at));
  const ref: ChartTrackRef = { kind: "event", event: kind };
  const name = chartEventKindLabel(kind);

  if (kind === "encounter") {
    return {
      ref,
      name,
      spans: bars.map((bar) => ({ start: epochOf(bar.at), end: epochOf(bar.end ?? bar.at) + DAY_MS, label: "入院", index: 0, level: 2 })),
      strata: [{ index: 0, label: "入院中", level: 2 }],
      rest: "入院外",
    };
  }

  if (kind === "chemo") {
    // クールの名前はそのまま持ち、層は「クール中 / クール外」の 2 つに畳む
    // (クールごとに列を分けると n が小さくなりすぎる)。
    return {
      ref,
      name,
      spans: bars.map((bar) => ({ start: epochOf(bar.at), end: epochOf(bar.end ?? bar.at) + DAY_MS, label: bar.detail.split(" / ")[0] || bar.label, index: 0, level: 2 })),
      strata: [{ index: 0, label: "クール中", level: 2 }],
      rest: "クール外",
    };
  }

  const grades = [...new Set(bars.map((bar) => bar.grade ?? 0).filter((grade) => grade > 0))].sort();
  return {
    ref,
    name,
    spans: bars.map((bar) => ({
      start: epochOf(bar.at),
      end: epochOf(bar.end ?? bar.at) + DAY_MS,
      label: bar.label,
      index: bar.grade ?? -1,
      level: adverseGradeLevel(bar.grade),
    })),
    strata: grades.map((grade) => ({ index: grade, label: `G${grade}`, level: adverseGradeLevel(grade) })),
    rest: "なし",
  };
}

function levelOf(index: number, count: number): number {
  if (index < 0) return 0;
  if (count <= 1) return 2;
  return Math.round((index / (count - 1)) * (CHOICE_LEVELS - 1));
}

/** 基準日の前後を層にする(層別の要約の「基準日の前後」)。 */
export function anchorStateTrack(anchor: string, range: ChartRange): ChartStateTrack {
  const at = epochOf(anchor);
  return {
    ref: { kind: "event", event: "encounter" },
    name: "基準日の前後",
    spans: [
      { start: range.tMin - DAY_MS, end: at, label: "基準日より前", index: 0, level: 1 },
      { start: at, end: range.tMax + DAY_MS, label: "基準日以後", index: 1, level: 3 },
    ],
    strata: [
      { index: 0, label: "基準日より前", level: 1 },
      { index: 1, label: "基準日以後", level: 3 },
    ],
  };
}

// ---- 層別の要約 ----

export interface ChartStratumSummary {
  label: string;
  n: number;
  median?: number;
  min?: number;
  max?: number;
  /** 基準外(判定あり)の割合 0〜1。判定を持たない項目は undefined。 */
  outOfRange?: number;
}

/** 系列の点を層に振り分けて要約する。層の列は strata の順 + rest(あれば)。 */
export function stratifySeries(
  points: ChartPoint[],
  track: ChartStateTrack,
  judged: boolean,
): ChartStratumSummary[] {
  const buckets = new Map<string, ChartPoint[]>();
  const columns = [...track.strata.map((stratum) => stratum.label), ...(track.rest ? [track.rest] : [])];
  for (const label of columns) buckets.set(label, []);
  for (const point of points) {
    const stratum = stratumAt(track, point.t);
    const label = stratum?.label ?? track.rest;
    if (!label) continue;
    buckets.get(label)?.push(point);
  }
  return columns.map((label) => {
    const bucket = buckets.get(label) ?? [];
    const values = bucket.map((point) => point.value);
    return {
      label,
      n: bucket.length,
      median: median(values),
      min: values.length ? Math.min(...values) : undefined,
      max: values.length ? Math.max(...values) : undefined,
      outOfRange:
        judged && bucket.length ? bucket.filter((point) => point.flag !== "").length / bucket.length : undefined,
    };
  });
}

// ---- 2 項目の対比 ----

export interface ChartPairSource {
  t: number;
  at: string;
  value: number;
}

export interface ChartPair {
  x: number;
  y: number;
  xAt: string;
  yAt: string;
  /** X の時刻。点の濃淡(古いほど薄い)に使う。 */
  t: number;
}

/**
 * X の各記録に、窓(±日数)の中で最も近い未使用の Y の記録を対応させる(時刻順に貪欲)。
 * 同じ日なら窓 0。
 */
export function pairByTime(xs: ChartPairSource[], ys: ChartPairSource[], windowDays: number): ChartPair[] {
  const window = windowDays * DAY_MS + (windowDays === 0 ? DAY_MS - 1 : 0);
  const sortedX = [...xs].sort((a, b) => a.t - b.t);
  const sortedY = [...ys].sort((a, b) => a.t - b.t);
  const used = new Set<number>();
  const pairs: ChartPair[] = [];
  for (const x of sortedX) {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < sortedY.length; i += 1) {
      if (used.has(i)) continue;
      const distance = windowDays === 0 ? sameDayDistance(x.at, sortedY[i].at) : Math.abs(sortedY[i].t - x.t);
      if (distance === null || distance > window) continue;
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    if (best < 0) continue;
    used.add(best);
    const y = sortedY[best];
    pairs.push({ x: x.value, y: y.value, xAt: x.at, yAt: y.at, t: x.t });
  }
  return pairs;
}

/** 同じ日なら時刻の差、違う日なら null。 */
function sameDayDistance(a: string, b: string): number | null {
  if (a.slice(0, 10) !== b.slice(0, 10)) return null;
  return Math.abs(epochOf(a) - epochOf(b));
}
