import { csvBlob } from "../lib/csv";
import type { IndicatorExtractDefinition, TargetDirection } from "./extractRecordQuery";
import { EMPTY_ATTRIBUTE, STRATUM_COLUMN } from "./recordTableHelpers";

// データ抽出の「指標」タブ(docs/data-extract-design.md §23)の結果の組み立て。結果の表(患者 × 期間が 1 行)の
// 見出しとセルだけから、期間ごとの分母・分子の人数と割合を数える(タブの画面とダッシュボードが同じ関数を使う)。

/** 固定列の見出し。「期間」は刻みの最初の日(内訳の期間の軸に載る)、「期間名」は刻みの名前、「分子」は該当か。 */
export const INDICATOR_PERIOD_COLUMN = "期間";
export const INDICATOR_PERIOD_NAME_COLUMN = "期間名";
export const INDICATOR_HIT_COLUMN = "分子";
export const INDICATOR_HIT = "該当";
export const INDICATOR_MISS = "非該当";

/** 期間 1 つ(と群 1 つ)の分母・分子。indices は結果の行の添字(押すと一覧をその行に絞る)。 */
export interface IndicatorCount {
  denominator: number;
  numerator: number;
  /** 割合(%)。分母 0 なら null。 */
  rate: number | null;
  indices: number[];
  hitIndices: number[];
}

export interface IndicatorPoint extends IndicatorCount {
  /** 刻みの最初の日。 */
  date: string;
  label: string;
  /** 比較群ごとの数(群の名前 → 数)。 */
  groups: Map<string, IndicatorCount>;
}

export interface IndicatorPoints {
  points: IndicatorPoint[];
  /** 比較群の名前(人数の多い順)。比較群の列が無ければ空。 */
  groupNames: string[];
}

export function rateOf(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

class Counter {
  patients = new Set<string>();
  hits = new Set<string>();
  indices: number[] = [];
  hitIndices: number[] = [];

  add(index: number, patientId: string, hit: boolean) {
    this.patients.add(patientId);
    this.indices.push(index);
    if (hit) {
      this.hits.add(patientId);
      this.hitIndices.push(index);
    }
  }

  result(): IndicatorCount {
    return {
      denominator: this.patients.size,
      numerator: this.hits.size,
      rate: rateOf(this.hits.size, this.patients.size),
      indices: this.indices,
      hitIndices: this.hitIndices,
    };
  }
}

/**
 * 期間ごとの分母・分子・割合。header と cells は結果の表(属性の列を含む)で、patientIds は行ごとの患者。
 * periods を渡すと、行の無い期間も分母 0 で並べる。
 * 「比較群」の列があれば、群ごとの数も出す(2 つ以上の群に入る患者は両方に数える)。
 */
export function indicatorPointsOf(
  header: string[],
  cells: string[][],
  patientIds: string[],
  periods: { date: string; label: string }[] = [],
): IndicatorPoints {
  const dateIndex = header.indexOf(INDICATOR_PERIOD_COLUMN);
  const nameIndex = header.indexOf(INDICATOR_PERIOD_NAME_COLUMN);
  const hitIndex = header.indexOf(INDICATOR_HIT_COLUMN);
  const groupIndex = header.indexOf(STRATUM_COLUMN);
  if (dateIndex < 0 || hitIndex < 0) return { points: [], groupNames: [] };
  const byDate = new Map<string, { label: string; total: Counter; groups: Map<string, Counter> }>();
  for (const period of periods) byDate.set(period.date, { label: period.label, total: new Counter(), groups: new Map() });
  const groupSizes = new Map<string, Set<string>>();
  cells.forEach((row, i) => {
    const date = row[dateIndex] ?? "";
    let point = byDate.get(date);
    if (!point) {
      point = { label: nameIndex >= 0 ? row[nameIndex] || date : date, total: new Counter(), groups: new Map() };
      byDate.set(date, point);
    }
    const hit = row[hitIndex] === INDICATOR_HIT;
    const patientId = patientIds[i] ?? "";
    point.total.add(i, patientId, hit);
    if (groupIndex < 0) return;
    const names = (row[groupIndex] ?? "")
      .split("、")
      .map((name) => name.trim())
      .filter((name) => name && name !== EMPTY_ATTRIBUTE);
    for (const name of names) {
      let counter = point.groups.get(name);
      if (!counter) {
        counter = new Counter();
        point.groups.set(name, counter);
      }
      counter.add(i, patientId, hit);
      let size = groupSizes.get(name);
      if (!size) {
        size = new Set();
        groupSizes.set(name, size);
      }
      size.add(patientId);
    }
  });
  const groupNames = [...groupSizes].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0], "ja")).map(([n]) => n);
  const points = [...byDate]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, point]) => ({
      date,
      label: point.label,
      ...point.total.result(),
      groups: new Map(groupNames.map((name) => [name, (point.groups.get(name) ?? new Counter()).result()])),
    }));
  return { points, groupNames };
}

/** 目標に達しているか(目標が無ければ null)。 */
export function meetsTarget(rate: number | null, target: number | undefined, direction: TargetDirection | undefined): boolean | null {
  if (rate === null || target == null) return null;
  return direction === "le" ? rate <= target : rate >= target;
}

/** ダッシュボードの「件数」のタイルに出す 1 行(直近の、分母のある期間の割合)。 */
export function indicatorHeadline(points: IndicatorPoint[]): string {
  const latest = [...points].reverse().find((p) => p.denominator > 0);
  if (!latest) return "分母の患者はいません";
  return `${latest.label} ${latest.rate}%(${latest.numerator}/${latest.denominator})`;
}

export function targetLabel(definition: Pick<IndicatorExtractDefinition, "target" | "target_direction">): string {
  if (definition.target == null) return "";
  return `目標 ${definition.target}%${definition.target_direction === "le" ? "以下" : "以上"}`;
}

/** 指標の CSV(期間 1 行。比較群があれば群ごとの分母・分子・割合の列を足す)。 */
export function indicatorCsv(points: IndicatorPoints): Blob {
  const groupHeader = points.groupNames.flatMap((name) => [`${name} 分母`, `${name} 分子`, `${name} 割合`]);
  const header = ["期間", "開始日", "分母", "分子", "割合", ...groupHeader];
  const rows = points.points.map((p): (string | number | null)[] => [
    p.label,
    p.date,
    p.denominator,
    p.numerator,
    p.rate,
    ...points.groupNames.flatMap((name): (string | number | null)[] => {
      const g = p.groups.get(name);
      return g ? [g.denominator, g.numerator, g.rate] : ["", "", ""];
    }),
  ]);
  return csvBlob(header, rows);
}
