import { AGE_BANDS, ageBandOf, leafLabel } from "./extractQueryHelpers";
import type { ExtractLeaf } from "./extractQueryModel";
import type { ExtractMetric } from "./extractRecordQuery";
import type { RecordTableRow } from "./recordTableHelpers";

// データ抽出の「クラスタ」タブ(docs/data-extract-design.md §22)の結果の組み立て。クラスタごとの概要
// (人数・性別・年齢・指標の該当と値)とクラスタどうしの重なりを、結果の表の行(絞り込み後に読めた患者)と
// 患者 → クラスタ名の対応から数える。

/** 指標の名前(付けた名前か条件の表示名)。見出しにも使うので指標どうしで重ならないようにする。 */
export function metricName(metric: ExtractMetric): string {
  return metric.label?.trim() || leafLabel(metric as ExtractLeaf);
}

/** 指標 1 つの列の見出し(件数・最新・最終日)。最新は検査結果なら単位を添える。 */
export function metricHeader(name: string, unit?: string): string[] {
  return [`${name} 件数`, `${name} 最新${unit ? `(${unit})` : ""}`, `${name} 最終日`];
}

/** 結果の行の値のうち、指標 1 つの列の位置(行の values の添字)と、最新が数値か。 */
export interface ClusterMetricColumn {
  name: string;
  countIndex: number;
  latestIndex: number;
  numeric: boolean;
}

export function clusterMetricColumns(metrics: { name: string; numeric: boolean }[]): ClusterMetricColumn[] {
  return metrics.map((m, i) => ({ name: m.name, countIndex: i * 3, latestIndex: i * 3 + 1, numeric: m.numeric }));
}

/** 概要の 1 セル。indices は結果の行の添字(押すと一覧をその患者に絞る)。 */
export interface ClusterCell {
  text: string;
  indices: number[];
}

export interface ClusterSummaryRow {
  label: string;
  cells: ClusterCell[];
}

export interface ClusterSummary {
  /** 列(クラスタの名前と「いずれか」)。 */
  columns: string[];
  sections: { label: string; rows: ClusterSummaryRow[] }[];
}

export const ANY_CLUSTER = "いずれか";

function percent(n: number, total: number): string {
  return total === 0 ? "-" : `${((n / total) * 100).toFixed(1)}%`;
}

function countCell(indices: number[], total: number): ClusterCell {
  return { text: `${indices.length}(${percent(indices.length, total)})`, indices };
}

function round1(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** クラスタごとの行の添字(列の並び。最後は「いずれか」=すべての行)。 */
export function clusterMembers(
  rows: RecordTableRow[],
  groupsOf: Map<string, string[]> | null,
  clusterNames: string[],
): number[][] {
  const members = clusterNames.map((name) =>
    rows.flatMap((row, i) => (groupsOf?.get(row.patient.patientId)?.includes(name) ? [i] : [])),
  );
  return [...members, rows.map((_, i) => i)];
}

export function clusterSummary(
  rows: RecordTableRow[],
  groupsOf: Map<string, string[]> | null,
  clusterNames: string[],
  metricColumns: ClusterMetricColumn[],
): ClusterSummary {
  const members = clusterMembers(rows, groupsOf, clusterNames);
  const columns = [...clusterNames, ANY_CLUSTER];
  const each = (cell: (indices: number[]) => ClusterCell): ClusterCell[] => members.map(cell);
  const where = (indices: number[], test: (row: RecordTableRow) => boolean) => indices.filter((i) => test(rows[i]));

  const genders = [...new Set(rows.map((row) => row.patient.gender || "不明"))].sort();
  const bands = [...AGE_BANDS, "不明"].filter((band) => rows.some((row) => ageBandOf(row.patient.age) === band));
  const ageStat = (indices: number[], stat: (ages: number[]) => number): ClusterCell => {
    const withAge = where(indices, (row) => row.patient.age != null);
    const ages = withAge.map((i) => rows[i].patient.age!);
    return { text: ages.length ? round1(stat(ages)) : "-", indices: withAge };
  };

  const sections: ClusterSummary["sections"] = [
    { label: "人数", rows: [{ label: "人数", cells: each((indices) => ({ text: String(indices.length), indices })) }] },
    {
      label: "性別",
      rows: genders.map((gender) => ({
        label: gender,
        cells: each((indices) => countCell(where(indices, (row) => (row.patient.gender || "不明") === gender), indices.length)),
      })),
    },
    {
      label: "年齢",
      rows: [
        { label: "平均", cells: each((indices) => ageStat(indices, (ages) => ages.reduce((a, b) => a + b, 0) / ages.length)) },
        { label: "中央値", cells: each((indices) => ageStat(indices, median)) },
        ...bands.map((band) => ({
          label: band,
          cells: each((indices) => countCell(where(indices, (row) => ageBandOf(row.patient.age) === band), indices.length)),
        })),
      ],
    },
  ];

  for (const metric of metricColumns) {
    const countOf = (row: RecordTableRow) => Number(row.values[metric.countIndex] || 0);
    const metricRows: ClusterSummaryRow[] = [
      {
        label: "該当",
        cells: each((indices) => countCell(where(indices, (row) => countOf(row) > 0), indices.length)),
      },
      {
        label: "件数",
        cells: each((indices) => {
          const hit = where(indices, (row) => countOf(row) > 0);
          return { text: String(hit.reduce((sum, i) => sum + countOf(rows[i]), 0)), indices: hit };
        }),
      },
    ];
    if (metric.numeric) {
      const valueOf = (row: RecordTableRow) => row.values[metric.latestIndex];
      metricRows.push({
        label: "最新の平均",
        cells: each((indices) => {
          const withValue = where(indices, (row) => Boolean(valueOf(row)) && Number.isFinite(Number(valueOf(row))));
          const values = withValue.map((i) => Number(valueOf(rows[i])));
          const text = values.length ? `${round1(values.reduce((a, b) => a + b, 0) / values.length)}(${values.length})` : "-";
          return { text, indices: withValue };
        }),
      });
    }
    sections.push({ label: metric.name, rows: metricRows });
  }
  return { columns, sections };
}

/** クラスタどうしの共通の患者(行の添字)。対角はそのクラスタの患者。 */
export function clusterOverlap(
  rows: RecordTableRow[],
  groupsOf: Map<string, string[]> | null,
  clusterNames: string[],
): number[][][] {
  const members = clusterMembers(rows, groupsOf, clusterNames).slice(0, clusterNames.length);
  return members.map((a) => {
    return members.map((b) => {
      const inB = new Set(b);
      return a.filter((i) => inB.has(i));
    });
  });
}
