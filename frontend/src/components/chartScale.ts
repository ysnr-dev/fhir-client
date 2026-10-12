// グラフの目盛りと数値・日時の書式、系列の印と数値ラベルの配置。検体検査の時系列(LabTimelineChart)と
// チャート(PatientChartPanel)で同じ見え方にするため、部品ではなくここに置く。

export function formatValue(value: number): string {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

/** ツールチップの見出し。日時で渡されたときだけ時刻も出す。 */
export function formatPointDate(date: string): string {
  const time = date.slice(11, 16);
  return time ? `${date.slice(0, 10)} ${time}` : date;
}

// 値域を覆う「きりのよい」目盛り(4分割程度)を返す。
export function niceTicks(min: number, max: number, minStep = 0): number[] {
  if (min === max) {
    // 全点が同じ値のときは値を中央に置ける適当な幅をとる。
    const pad = Math.abs(min) || 1;
    min -= pad / 2;
    max += pad / 2;
  }
  // minStep は目盛りの最小の刻み(人数のように整数しか取らない値は 1 にして小数の目盛りを出さない)。
  const rawStep = Math.max((max - min) / 4, minStep);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? rawStep;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; ; v += step) {
    // 0.30000000000000004 のような誤差を丸める。
    const tick = Number(v.toPrecision(12));
    ticks.push(tick);
    if (tick >= max) break;
  }
  return ticks;
}

/** 系列の色は dataviz の検証済みカテゴリ配色を順に使う(CSS の .patient-chart__s1〜8)。 */
export const SERIES_SLOTS = 8;
/** 印の形。色と組で系列を見分ける(色だけに頼らない)。8 と 5 は互いに素なので 40 通り。 */
export const SERIES_SHAPES = 5;

/** 系列の印。色だけに頼らずに見分けられるよう、形も変える。 */
export function seriesMarkPath(shape: number, x: number, y: number, r: number): string {
  if (shape === 1) return `M${x - r},${y - r} L${x + r},${y - r} L${x},${y + r} Z`;
  if (shape === 2) return `M${x - r},${y - r} H${x + r} V${y + r} H${x - r} Z`;
  if (shape === 3) return `M${x - r},${y + r} L${x + r},${y + r} L${x},${y - r} Z`;
  if (shape === 4) return `M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`;
  // 0 = 丸。パスで描くと他の形と線幅がそろう。
  return `M${x - r},${y} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
}

/** 点の上に出す数値の字の大きさ。 */
export const VALUE_FONT = 10;

export interface ValueLabel {
  key: string;
  x: number;
  y: number;
  text: string;
  /** 判定(H/L など)。数値の字の色を変える。 */
  flag: string;
}

/**
 * 点の数値ラベルを、重ならないものだけ残す(左から順に置けるものだけ置く)。
 * 測定が詰まっている期間は全部には出せないので、間引いて読める密度にする。
 */
export function placeValueLabels(candidates: ValueLabel[], fontSize = VALUE_FONT): ValueLabel[] {
  const widthOf = (text: string) =>
    [...text].reduce((sum, char) => sum + (/[\u0020-\u00ff]/.test(char) ? fontSize * 0.55 : fontSize), 0);
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const result: ValueLabel[] = [];

  for (const candidate of [...candidates].sort((a, b) => a.x - b.x)) {
    const half = widthOf(candidate.text) / 2 + 2;
    const box = {
      left: candidate.x - half,
      right: candidate.x + half,
      top: candidate.y - fontSize - 2,
      bottom: candidate.y + 2,
    };
    const hit = placed.some(
      (other) =>
        box.left < other.right &&
        box.right > other.left &&
        box.top < other.bottom &&
        box.bottom > other.top,
    );
    if (hit) continue;
    placed.push(box);
    result.push(candidate);
  }

  return result;
}
