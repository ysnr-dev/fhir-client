import { csvBlob } from "../lib/csv";
import { EMPTY_ATTRIBUTE, STRATUM_COLUMN } from "./recordTableHelpers";

// データ抽出の「イベント」タブ(docs/data-extract-design.md §25)の結果の組み立て。結果の表(患者 1 人が 1 行)の
// 見出しとセルだけから、基準日からの日数と転帰を読み、累積発生率(Kaplan-Meier の 1 − S(t))を全体と比較群ごとに数える。

export const EVENT_INDEX_COLUMN = "基準日";
export const EVENT_DAY_COLUMN = "イベント日";
export const EVENT_DAYS_COLUMN = "日数";
export const EVENT_OUTCOME_COLUMN = "転帰";
export const EVENT_END_COLUMN = "観察終了日";
export const EVENT_OCCURRED = "発生";
export const EVENT_CENSORED = "打ち切り";

/** 累積発生率の曲線の 1 点(時刻 t の直後の値)。 */
export interface IncidenceStep {
  t: number;
  /** t の直前のリスク集団の人数。 */
  atRisk: number;
  events: number;
  censored: number;
  /** 累積発生率(%)。 */
  value: number;
}

export interface IncidenceCurve {
  label: string;
  /** 結果の行の添字(押すと一覧をその患者に絞る)。 */
  indices: number[];
  count: number;
  events: number;
  censored: number;
  /** 累積発生率が 50% に達した日数。達しなければ null。 */
  median: number | null;
  steps: IncidenceStep[];
}

/** Kaplan-Meier。同じ日の発生と打ち切りは発生を先に数える。最初の点は t=0 の 0%。 */
export function cumulativeIncidence(subjects: { days: number; event: boolean }[]): IncidenceStep[] {
  const sorted = [...subjects].sort((a, b) => a.days - b.days || Number(b.event) - Number(a.event));
  const steps: IncidenceStep[] = [{ t: 0, atRisk: sorted.length, events: 0, censored: 0, value: 0 }];
  let survival = 1;
  let i = 0;
  while (i < sorted.length) {
    const t = sorted[i].days;
    const atRisk = sorted.length - i;
    let events = 0;
    let censored = 0;
    while (i < sorted.length && sorted[i].days === t) {
      if (sorted[i].event) events += 1;
      else censored += 1;
      i += 1;
    }
    if (events > 0) survival *= 1 - events / atRisk;
    steps.push({ t, atRisk, events, censored, value: Math.round((1 - survival) * 1000) / 10 });
  }
  return steps;
}

/** 時刻 t での累積発生率(%)と、その時点のリスク集団。 */
export function incidenceAt(steps: IncidenceStep[], t: number): { value: number; atRisk: number } {
  let value = 0;
  let atRisk = steps[0]?.atRisk ?? 0;
  for (const step of steps) {
    if (step.t > t) break;
    value = step.value;
    atRisk = step.atRisk - step.events - step.censored;
  }
  return { value, atRisk };
}

/**
 * 全体と比較群ごとの曲線。header と cells は結果の表(属性の列を含む)。日数か転帰の列が無ければ空。
 * 群は人数の多い順に limit まで。
 */
export function incidenceCurves(header: string[], cells: string[][], limit = 8): IncidenceCurve[] {
  const daysIndex = header.indexOf(EVENT_DAYS_COLUMN);
  const outcomeIndex = header.indexOf(EVENT_OUTCOME_COLUMN);
  const groupIndex = header.indexOf(STRATUM_COLUMN);
  if (daysIndex < 0 || outcomeIndex < 0) return [];
  const members = new Map<string, number[]>([["全体", cells.map((_, i) => i)]]);
  if (groupIndex >= 0) {
    cells.forEach((row, i) => {
      const names = (row[groupIndex] ?? "")
        .split("、")
        .map((name) => name.trim())
        .filter((name) => name && name !== EMPTY_ATTRIBUTE);
      for (const name of names) members.set(name, [...(members.get(name) ?? []), i]);
    });
  }
  const groups = [...members].slice(0, 1).concat(
    [...members].slice(1).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ja")).slice(0, limit - 1),
  );
  return groups.map(([label, indices]) => {
    const subjects = indices.map((i) => ({
      days: Math.max(0, Number(cells[i][daysIndex]) || 0),
      event: cells[i][outcomeIndex] === EVENT_OCCURRED,
    }));
    const steps = cumulativeIncidence(subjects);
    const median = steps.find((step) => step.value >= 50)?.t ?? null;
    return {
      label,
      indices,
      count: subjects.length,
      events: subjects.filter((s) => s.event).length,
      censored: subjects.filter((s) => !s.event).length,
      median,
      steps,
    };
  });
}

/** 表の節目の日数(30・90・180・365 日のうち最大の日数まで、最後に最大の日数)。 */
export function milestonesOf(maxDays: number): number[] {
  const marks = [30, 90, 180, 365, 730].filter((t) => t < maxDays);
  return [...marks, maxDays].filter((t, i, all) => t > 0 && all.indexOf(t) === i);
}

/** 曲線の CSV(群・日数・リスク集団・発生・打ち切り・累積発生率を 1 段 1 行)。 */
export function incidenceCsv(curves: IncidenceCurve[]): Blob {
  const header = ["群", "日数", "リスク集団", "発生", "打ち切り", "累積発生率"];
  const rows = curves.flatMap((curve) =>
    curve.steps.map((step): (string | number)[] => [curve.label, step.t, step.atRisk, step.events, step.censored, step.value]),
  );
  return csvBlob(header, rows);
}
