import { csvBlob } from "../lib/csv";

// 記録を表にするタブの内訳(docs/data-extract-design.md §18)。結果の表(見出しと行のセル)だけから、
// 行と列の軸に期間(年・年度・四半期・月・週・日)か分類の列を置き、件数・患者数と数値の列の集計を出す。
// 列の種類(日付・数値・分類・患者情報)は columnKindOf の規則で決め、タブごとの知識は持たない。

/** 分類の値をまとめずに出す数。超えた分は「その他」にまとめる。 */
export const BREAKDOWN_MAX_CATEGORIES = 30;
const OTHER = "その他";
const EMPTY = "(なし)";
const TOTAL = "計";

// ---- 列の種類 ----

export type ColumnKind = "date" | "number" | "category" | "patient";

/**
 * 患者を表すだけで内訳にならない列。患者番号・氏名・患者ID は 1 人 1 値、生年月日は記録の日付ではない
 * (期間は記録の日付で数える。生まれで分けるなら年齢を使う)。
 */
const PATIENT_LABELS = new Set(["患者番号", "氏名", "カナ", "患者ID", "生年月日", "郵便番号", "住所", "電話"]);

/** 数字だけでも量ではない列(コード・番号)。名前で見分けて分類として扱う。 */
const CODE_LABEL = /(コード|番号|ID|^RP$|^版$)/;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/** 値のあるセルのうち、この割合以上が日付(数値)なら日付(数値)の列とみなす。 */
const KIND_RATIO = 0.8;

/**
 * 列の種類。患者情報とコード・番号の列は名前で決め、残りは値から決める(値のあるセルの 8 割以上が日付なら日付、
 * 数値なら数値)。年齢は数値の列で、分類に選べば 10 歳刻みにまとめる。
 */
export function columnKindOf(label: string, values: string[]): ColumnKind {
  if (PATIENT_LABELS.has(label)) return "patient";
  if (CODE_LABEL.test(label)) return "category";
  const filled = values.filter(Boolean);
  if (filled.length === 0) return "category";
  if (filled.filter((v) => DATE_PATTERN.test(v)).length / filled.length >= KIND_RATIO) return "date";
  if (filled.filter((v) => NUMBER_PATTERN.test(v.trim())).length / filled.length >= KIND_RATIO) return "number";
  return "category";
}

export interface BreakdownColumn {
  index: number;
  label: string;
  kind: ColumnKind;
}

/** 内訳に使える列(患者情報の列は外す)。 */
export function breakdownColumns(header: string[], cells: string[][]): BreakdownColumn[] {
  return header.flatMap((label, index) => {
    const kind = columnKindOf(
      label,
      cells.map((row) => row[index] ?? ""),
    );
    return kind === "patient" ? [] : [{ index, label, kind }];
  });
}

// ---- 期間の刻み ----

export type TimeGrain = "year" | "fiscal" | "quarter" | "month" | "week" | "day";

export const TIME_GRAINS: { value: TimeGrain; label: string }[] = [
  { value: "year", label: "年" },
  { value: "fiscal", label: "年度" },
  { value: "quarter", label: "四半期" },
  { value: "month", label: "月" },
  { value: "week", label: "週" },
  { value: "day", label: "日" },
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 日付の値を刻みのキーにする(キーは文字列の並びで時間の順になる)。日付でなければ null。 */
function grainKey(value: string, grain: TimeGrain): string | null {
  if (!DATE_PATTERN.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  switch (grain) {
    case "year":
      return String(year);
    case "fiscal":
      return String(month >= 4 ? year : year - 1);
    case "quarter":
      return `${year}-${Math.ceil(month / 3)}`;
    case "month":
      return value.slice(0, 7);
    case "day":
      return value.slice(0, 10);
    case "week": {
      // 月曜始まりの週。キーはその週の月曜日。
      const date = new Date(year, month - 1, Number(value.slice(8, 10)));
      date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      return ymd(date);
    }
  }
}

/** 刻みのキーの見出し。 */
function grainLabel(key: string, grain: TimeGrain): string {
  switch (grain) {
    case "year":
      return `${key}年`;
    case "fiscal":
      return `${key}年度`;
    case "quarter": {
      const [year, q] = key.split("-").map(Number);
      return `${year}年${q * 3 - 2}〜${q * 3}月`;
    }
    case "week":
      return `${key}〜`;
    default:
      return key;
  }
}

/** 刻みのキーの次。0 件の期間を埋めるのに使う。 */
function nextGrainKey(key: string, grain: TimeGrain): string {
  switch (grain) {
    case "year":
    case "fiscal":
      return String(Number(key) + 1);
    case "quarter": {
      const [year, q] = key.split("-").map(Number);
      return q === 4 ? `${year + 1}-1` : `${year}-${q + 1}`;
    }
    case "month": {
      const [year, month] = key.split("-").map(Number);
      return month === 12 ? `${year + 1}-01` : `${year}-${pad2(month + 1)}`;
    }
    case "day":
    case "week": {
      const date = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
      date.setDate(date.getDate() + (grain === "week" ? 7 : 1));
      return ymd(date);
    }
  }
}

/** 0 件の期間を埋める上限(日の刻みで何年もの期間を選んだときに表が膨らみすぎないように)。超えたら埋めない。 */
export const MAX_FILLED_PERIODS = 400;

/** 期間のキーを時間の順に並べる。fill なら最初と最後の間の 0 件の期間も入れる。日付の無い行は最後に「(なし)」。 */
function periodKeys(keys: string[], grain: TimeGrain, fill: boolean): { keys: string[]; filled: boolean } {
  const dated = [...new Set(keys.filter((k) => k !== EMPTY))].sort();
  let result = dated;
  let filled = false;
  if (fill && dated.length > 1) {
    const all: string[] = [];
    let key = dated[0];
    const last = dated[dated.length - 1];
    while (key <= last && all.length <= MAX_FILLED_PERIODS) {
      all.push(key);
      key = nextGrainKey(key, grain);
    }
    if (all.length <= MAX_FILLED_PERIODS) {
      result = all;
      filled = true;
    }
  }
  return { keys: keys.includes(EMPTY) ? [...result, EMPTY] : result, filled };
}

// ---- 数値の集計 ----

export type Metric = "sum" | "mean" | "median" | "min" | "max";

export const METRICS: { value: Metric; label: string }[] = [
  { value: "sum", label: "合計" },
  { value: "mean", label: "平均" },
  { value: "median", label: "中央値" },
  { value: "min", label: "最小" },
  { value: "max", label: "最大" },
];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function metricOf(values: number[], metric: Metric): number | null {
  if (values.length === 0) return null;
  switch (metric) {
    case "sum":
      return round(values.reduce((s, v) => s + v, 0));
    case "mean":
      return round(values.reduce((s, v) => s + v, 0) / values.length);
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "median": {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
    }
  }
}

// ---- 内訳の切り口(保存する条件に含める) ----

/**
 * 内訳の切り口。保存する条件(§17)の breakdown に入れる。列は位置ではなく見出しの名前で持つ(実行し直して
 * 列の並びが変わっても同じ列を指すように)。無い項目は既定(最初の日付の列・月ごと・行に期間)。
 */
export interface BreakdownSettings {
  /** 期間にする列の見出し。"" は期間なし。 */
  date?: string;
  grain?: TimeGrain;
  fill_empty?: boolean;
  /** 行の軸。"period" は期間、"" は計のみ、それ以外は分類の列の見出し。 */
  rows?: string;
  /** 列の軸。"period" は期間、"" か無しは分けない、それ以外は分類の列の見出し。 */
  columns?: string;
  /** 集計する数値の列の見出し。無ければ件数。 */
  value?: string;
  metric?: Metric;
  /** 添えの数(患者数か件数)を出す。 */
  show_sub?: boolean;
  /** 割合を出す(行の中の構成比か、列の中の構成比)。 */
  ratio?: BreakdownRatio;
  split_multi?: boolean;
}

export type BreakdownRatio = "row" | "column";

// ---- 内訳 ----

/** 列の軸に置く分類の値の数(横に広がりすぎないように行より少なくする)。 */
export const BREAKDOWN_MAX_COLUMN_CATEGORIES = 12;

/** 分類の値。年齢は 10 歳刻みにまとめる(1 歳ごとでは表にならない)。 */
function categoryOf(label: string, value: string): string {
  if (!value) return EMPTY;
  if (label === "年齢") {
    const age = Number(value);
    return Number.isFinite(age) ? `${Math.floor(age / 10) * 10}代` : value;
  }
  return value;
}

/** 内訳の軸。期間(選んだ日付の列と刻み)か、分類の列。 */
export type BreakdownAxis = { type: "period" } | { type: "category"; index: number };

export interface BreakdownOptions {
  /** 期間の列。null なら期間の軸は使えない。 */
  dateIndex: number | null;
  grain: TimeGrain;
  /** 0 件の期間も並べる。 */
  fillEmpty: boolean;
  /** 行の軸。null なら「計」の 1 行。 */
  rows: BreakdownAxis | null;
  /** 列の軸。null なら列に分けない(件数・患者数・集計値の列)。 */
  columns: BreakdownAxis | null;
  /** 集計する数値の列。null なら件数だけ。 */
  valueIndex: number | null;
  metric: Metric;
  /** 分類の値に「、」が入っていれば分けて数える(1 件が複数の値に数えられる)。 */
  splitMulti: boolean;
}

/** 複数の値をつないだセルの区切り(麻酔方法・担当看護師・用語など)。 */
const MULTI_SEPARATOR = "、";

/** セル 1 つの集計。value は数値の列を選んだときの集計値(値が 1 つも無ければ null)。indices は当たった行。 */
export interface BreakdownCell {
  records: number;
  patients: number;
  value: number | null;
  indices: number[];
}

export interface RecordBreakdown {
  /** 行の見出し(行の軸の名前。軸が無ければ空)。 */
  rowAxis: string;
  /** 列の見出し(列の軸の名前。軸が無ければ空)。 */
  columnAxis: string;
  rowLabels: string[];
  /** 列の値。列の軸が無ければ空。 */
  columnLabels: string[];
  /** [行][列] のセル。列の軸が無いときは [行][0] に行の計。 */
  cells: BreakdownCell[][];
  rowTotals: BreakdownCell[];
  columnTotals: BreakdownCell[];
  total: BreakdownCell;
  /** 数値の集計の見出し(「在院日数 平均」)。数値の列を選ばなければ null。 */
  valueLabel: string | null;
  /** 0 件の期間を埋めようとして、上限を超えたので埋めなかった。 */
  fillSkipped: boolean;
  /** 「その他」にまとめた軸の名前。 */
  truncatedAxes: string[];
  /** 分けて数えたため、1 件が複数の値に数えられた行がある。 */
  multiCounted: boolean;
}

class Accumulator {
  records = 0;
  patients = new Set<string>();
  values: number[] = [];
  indices: number[] = [];

  add(index: number, patientId: string, value: number | null) {
    this.records += 1;
    this.patients.add(patientId);
    this.indices.push(index);
    if (value !== null) this.values.push(value);
  }

  result(metric: Metric, withValue: boolean): BreakdownCell {
    return {
      records: this.records,
      patients: this.patients.size,
      value: withValue ? metricOf(this.values, metric) : null,
      indices: this.indices,
    };
  }
}

interface ResolvedAxis {
  name: string;
  keys: string[];
  labels: string[];
  /** その行が入る軸の値(分けて数えるときは複数)。 */
  keysOf: (row: string[]) => string[];
  filled: boolean;
  truncated: boolean;
}

/**
 * 軸の値の並び。期間は時間の順(fill なら 0 件の期間も)、分類は件数の多い順(年齢は年齢の順)で limit まで並べ、
 * 残りを「その他」にまとめる。
 */
function resolveAxis(
  axis: BreakdownAxis,
  header: string[],
  rows: string[][],
  options: BreakdownOptions,
  limit: number,
): ResolvedAxis {
  const { dateIndex, grain, fillEmpty } = options;
  if (axis.type === "period") {
    const keyOf = (row: string[]) =>
      dateIndex === null ? TOTAL : (grainKey(row[dateIndex] ?? "", grain) ?? EMPTY);
    const periods = dateIndex === null ? { keys: [TOTAL], filled: false } : periodKeys(rows.map(keyOf), grain, fillEmpty);
    return {
      name: TIME_GRAINS.find((g) => g.value === grain)?.label ?? "",
      keys: periods.keys,
      labels: periods.keys.map((key) => (key === EMPTY || dateIndex === null ? key : grainLabel(key, grain))),
      keysOf: (row) => [keyOf(row)],
      filled: periods.filled,
      truncated: false,
    };
  }
  const label = header[axis.index] ?? "";
  const rawOf = (row: string[]): string[] => {
    const cell = row[axis.index] ?? "";
    if (!options.splitMulti || !cell.includes(MULTI_SEPARATOR)) return [categoryOf(label, cell)];
    const parts = cell.split(MULTI_SEPARATOR).map((part) => part.trim()).filter(Boolean);
    return [...new Set(parts.map((part) => categoryOf(label, part)))];
  };
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of rawOf(row)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const byAge = label === "年齢";
  const ranked = [...counts]
    .sort((a, b) =>
      byAge
        ? (parseInt(a[0], 10) || 999) - (parseInt(b[0], 10) || 999)
        : b[1] - a[1] || a[0].localeCompare(b[0], "ja"),
    )
    .map(([value]) => value);
  const kept = new Set(ranked.slice(0, limit));
  const truncated = ranked.length > kept.size;
  const keys = [...ranked.slice(0, limit), ...(truncated ? [OTHER] : [])];
  return {
    name: label,
    keys,
    labels: keys,
    keysOf: (row) => [...new Set(rawOf(row).map((value) => (kept.has(value) ? value : OTHER)))],
    filled: false,
    truncated,
  };
}

const SINGLE: ResolvedAxis = {
  name: "",
  keys: [TOTAL],
  labels: [TOTAL],
  keysOf: () => [TOTAL],
  filled: false,
  truncated: false,
};

/**
 * 内訳を数える。行と列の軸はそれぞれ期間か分類の列(列は無しでもよい)。
 * 患者数はそのセルに当たった行の患者を重ねずに数えるので、計は各セルの和にならない。数値の集計も計は
 * 元の値から出し直す(平均の平均にしない)。数値の無いセルは集計の分母に入れない。
 * 各セルは当たった行の位置(indices)を持ち、セルから一覧へ絞り込むのに使う。
 */
export function recordBreakdown(
  header: string[],
  rows: string[][],
  patientIds: string[],
  options: BreakdownOptions,
): RecordBreakdown {
  const { valueIndex, metric } = options;
  const rowAxis = options.rows ? resolveAxis(options.rows, header, rows, options, BREAKDOWN_MAX_CATEGORIES) : SINGLE;
  const columnAxis = options.columns
    ? resolveAxis(options.columns, header, rows, options, BREAKDOWN_MAX_COLUMN_CATEGORIES)
    : null;
  const valueOf = (row: string[]) => {
    if (valueIndex === null) return null;
    const raw = (row[valueIndex] ?? "").trim();
    return NUMBER_PATTERN.test(raw) ? Number(raw) : null;
  };

  const width = columnAxis ? columnAxis.keys.length : 1;
  const cellAcc = rowAxis.keys.map(() => Array.from({ length: width }, () => new Accumulator()));
  const rowAcc = rowAxis.keys.map(() => new Accumulator());
  const columnAcc = Array.from({ length: width }, () => new Accumulator());
  const totalAcc = new Accumulator();
  const rowIndex = new Map(rowAxis.keys.map((key, i) => [key, i]));
  const columnIndex = new Map((columnAxis?.keys ?? []).map((key, i) => [key, i]));

  let multiCounted = false;
  rows.forEach((row, i) => {
    const rs = rowAxis.keysOf(row).flatMap((key) => rowIndex.get(key) ?? []);
    const cs = columnAxis ? columnAxis.keysOf(row).flatMap((key) => columnIndex.get(key) ?? []) : [0];
    if (rs.length === 0 || cs.length === 0) return;
    if (rs.length > 1 || cs.length > 1) multiCounted = true;
    const patientId = patientIds[i] ?? "";
    const value = valueOf(row);
    for (const r of rs) {
      rowAcc[r].add(i, patientId, value);
      for (const c of cs) cellAcc[r][c].add(i, patientId, value);
    }
    for (const c of cs) columnAcc[c].add(i, patientId, value);
    totalAcc.add(i, patientId, value);
  });

  const withValue = valueIndex !== null;
  const usesPeriod = options.rows?.type === "period" || options.columns?.type === "period";
  const periodAxis = options.rows?.type === "period" ? rowAxis : options.columns?.type === "period" ? columnAxis : null;
  return {
    rowAxis: rowAxis.name,
    columnAxis: columnAxis?.name ?? "",
    rowLabels: rowAxis.labels,
    columnLabels: columnAxis?.labels ?? [],
    cells: cellAcc.map((row) => row.map((acc) => acc.result(metric, withValue))),
    rowTotals: rowAcc.map((acc) => acc.result(metric, withValue)),
    columnTotals: columnAcc.map((acc) => acc.result(metric, withValue)),
    total: totalAcc.result(metric, withValue),
    valueLabel: withValue
      ? `${header[valueIndex] ?? ""} ${METRICS.find((m) => m.value === metric)?.label ?? ""}`
      : null,
    fillSkipped:
      usesPeriod &&
      options.dateIndex !== null &&
      options.fillEmpty &&
      periodAxis !== null &&
      !periodAxis.filled &&
      periodAxis.keys.filter((k) => k !== EMPTY).length > 1,
    truncatedAxes: [rowAxis, columnAxis].filter((a): a is ResolvedAxis => Boolean(a?.truncated)).map((a) => a.name),
    multiCounted,
  };
}

/**
 * 内訳の CSV。Excel のピボットに載せやすいよう、1 セル 1 行の縦持ちにする(計の行は出さない)。
 * 画面で患者数を外していれば患者数の列も出さない。数値の集計を選んでいればその列を足す。
 * 0 件のセルは withEmpty(0 件の期間も並べる)のときだけ出す。
 */
export function recordBreakdownCsv(breakdown: RecordBreakdown, withPatients = true, withEmpty = false): Blob {
  const hasColumns = breakdown.columnLabels.length > 0;
  const header = [
    ...(breakdown.rowAxis ? [breakdown.rowAxis] : []),
    ...(hasColumns ? [breakdown.columnAxis] : []),
    "件数",
    ...(withPatients ? ["患者数"] : []),
    ...(breakdown.valueLabel ? [breakdown.valueLabel] : []),
  ];
  const rows: (string | number | null)[][] = [];
  breakdown.rowLabels.forEach((rowLabel, r) => {
    const columns = hasColumns ? breakdown.columnLabels : [""];
    columns.forEach((columnLabel, c) => {
      const cell = breakdown.cells[r][c];
      if (cell.records === 0 && !withEmpty) return;
      rows.push([
        ...(breakdown.rowAxis ? [rowLabel] : []),
        ...(hasColumns ? [columnLabel] : []),
        cell.records,
        ...(withPatients ? [cell.patients] : []),
        ...(breakdown.valueLabel ? [cell.value] : []),
      ]);
    });
  });
  return csvBlob(header, rows);
}
