import { csvBlob } from "../lib/csv";

// 記録を表にするタブの内訳(docs/data-extract-design.md §18)。結果の表(見出しと行のセル)だけから、
// 日付の列で月別に、分類の列で値ごとに、件数(行の数)と患者数を数える。タブごとの知識は持たない。

/** 分類の値をまとめずに出す数。超えた分は「その他」にまとめる。 */
export const BREAKDOWN_MAX_CATEGORIES = 30;
const OTHER = "その他";
const EMPTY = "(なし)";
const TOTAL = "計";

/** 月別にできる列か(値のあるセルの 8 割以上が日付で始まる)。 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

export interface BreakdownColumn {
  index: number;
  label: string;
  isDate: boolean;
}

/**
 * 患者を表すだけで内訳にならない列。患者番号・氏名・患者ID は 1 人 1 値、生年月日は記録の日付ではない
 * (月別は記録の日付で数える。生まれで分けるなら年齢を使う)。
 */
const NOT_BREAKDOWN = new Set(["患者番号", "氏名", "カナ", "患者ID", "生年月日", "郵便番号", "住所", "電話"]);

/** 内訳に使える列。 */
export function breakdownColumns(header: string[], cells: string[][]): BreakdownColumn[] {
  return header.flatMap((label, index) => {
    if (NOT_BREAKDOWN.has(label)) return [];
    const values = cells.map((row) => row[index] ?? "").filter(Boolean);
    const dates = values.filter((value) => DATE_PATTERN.test(value)).length;
    return [{ index, label, isDate: values.length > 0 && dates / values.length >= 0.8 }];
  });
}

/** 分類の値。年齢は 10 歳刻みにまとめる(1 歳ごとでは表にならない)。 */
function categoryOf(label: string, value: string): string {
  if (!value) return EMPTY;
  if (label === "年齢") {
    const age = Number(value);
    return Number.isFinite(age) ? `${Math.floor(age / 10) * 10}代` : value;
  }
  return value;
}

export interface RecordBreakdown {
  /** 行の見出し(分類の列の名前。分類しなければ「月」、どちらも選ばなければ空)。 */
  rowAxis: string;
  /** 行(分類の値。分類しなければ月、どちらも選ばなければ「計」の 1 行)。 */
  rowLabels: string[];
  /** 列(分類と月の両方を選んだときの月。それ以外は無し)。 */
  columnLabels: string[];
  /** [行][列] の件数と患者数。列が無いときは [行][0] に行の計。 */
  records: number[][];
  patients: number[][];
  rowTotals: { records: number; patients: number }[];
  columnTotals: { records: number; patients: number }[];
  total: { records: number; patients: number };
}

function monthOf(value: string): string {
  return value.slice(0, 7) || EMPTY;
}

function sortMonths(months: string[]): string[] {
  return [...new Set(months)].sort((a, b) => (a === EMPTY ? 1 : b === EMPTY ? -1 : a.localeCompare(b)));
}

/**
 * 内訳を数える。分類の値は長く数も多いので行に、月は列に置く(分類しなければ月が行)。
 * 患者数はそのセルに当たった行の患者を重ねずに数えるので、計は各セルの和にならない。
 * 分類の値は件数の多い順に BREAKDOWN_MAX_CATEGORIES まで並べ、残りを「その他」にまとめる。
 */
export function recordBreakdown(
  header: string[],
  cells: string[][],
  patientIds: string[],
  dateIndex: number | null,
  categoryIndex: number | null,
): RecordBreakdown {
  const monthKeyOf = (row: string[]) => (dateIndex === null ? TOTAL : monthOf(row[dateIndex] ?? ""));
  const rawCategoryOf = (row: string[]) =>
    categoryIndex === null ? "" : categoryOf(header[categoryIndex] ?? "", row[categoryIndex] ?? "");

  const categoryCounts = new Map<string, number>();
  for (const row of cells) {
    const category = rawCategoryOf(row);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }
  // 年齢の帯は年齢の順、ほかは件数の多い順(同数は名前の順)。
  const byAge = categoryIndex !== null && header[categoryIndex] === "年齢";
  const ranked = [...categoryCounts]
    .sort((a, b) =>
      byAge
        ? (parseInt(a[0], 10) || 999) - (parseInt(b[0], 10) || 999)
        : b[1] - a[1] || a[0].localeCompare(b[0], "ja"),
    )
    .map(([c]) => c);
  const kept = new Set(ranked.slice(0, BREAKDOWN_MAX_CATEGORIES));
  const categories = [...ranked.slice(0, BREAKDOWN_MAX_CATEGORIES), ...(ranked.length > kept.size ? [OTHER] : [])];
  const categoryKeyOf = (row: string[]) => {
    const category = rawCategoryOf(row);
    return kept.has(category) ? category : OTHER;
  };

  const byCategory = categoryIndex !== null;
  const rowLabels = byCategory ? categories : sortMonths(cells.map(monthKeyOf));
  const rowKeyOf = byCategory ? categoryKeyOf : monthKeyOf;
  const columnLabels = byCategory && dateIndex !== null ? sortMonths(cells.map(monthKeyOf)) : [];
  const columnOf = (row: string[]) => (columnLabels.length ? columnLabels.indexOf(monthKeyOf(row)) : 0);

  const width = Math.max(columnLabels.length, 1);
  const cellPatients = rowLabels.map(() => Array.from({ length: width }, () => new Set<string>()));
  const records = rowLabels.map(() => Array.from({ length: width }, () => 0));
  const rowPatients = rowLabels.map(() => new Set<string>());
  const columnPatients = Array.from({ length: width }, () => new Set<string>());
  const columnRecords = Array.from({ length: width }, () => 0);
  const allPatients = new Set<string>();

  cells.forEach((row, i) => {
    const r = rowLabels.indexOf(rowKeyOf(row));
    const c = columnOf(row);
    const patientId = patientIds[i] ?? "";
    records[r][c] += 1;
    cellPatients[r][c].add(patientId);
    rowPatients[r].add(patientId);
    columnPatients[c].add(patientId);
    columnRecords[c] += 1;
    allPatients.add(patientId);
  });

  return {
    rowAxis: byCategory ? (header[categoryIndex] ?? "") : dateIndex !== null ? "月" : "",
    rowLabels,
    columnLabels,
    records,
    patients: cellPatients.map((row) => row.map((set) => set.size)),
    rowTotals: rowLabels.map((_, r) => ({
      records: records[r].reduce((sum, n) => sum + n, 0),
      patients: rowPatients[r].size,
    })),
    columnTotals: columnRecords.map((n, c) => ({ records: n, patients: columnPatients[c].size })),
    total: { records: cells.length, patients: allPatients.size },
  };
}

/**
 * 内訳の CSV。Excel のピボットに載せやすいよう、1 セル 1 行の縦持ちにする(計の行は出さない)。
 * 画面で患者数を外していれば患者数の列も出さない。
 */
export function recordBreakdownCsv(breakdown: RecordBreakdown, withPatients = true): Blob {
  const hasMonths = breakdown.columnLabels.length > 0;
  const header = [
    ...(breakdown.rowAxis ? [breakdown.rowAxis] : []),
    ...(hasMonths ? ["月"] : []),
    "件数",
    ...(withPatients ? ["患者数"] : []),
  ];
  const rows: (string | number)[][] = [];
  breakdown.rowLabels.forEach((rowLabel, r) => {
    const columns = hasMonths ? breakdown.columnLabels : [""];
    columns.forEach((columnLabel, c) => {
      if (breakdown.records[r][c] === 0) return;
      rows.push([
        ...(breakdown.rowAxis ? [rowLabel] : []),
        ...(hasMonths ? [columnLabel] : []),
        breakdown.records[r][c],
        ...(withPatients ? [breakdown.patients[r][c]] : []),
      ]);
    });
  });
  return csvBlob(header, rows);
}
