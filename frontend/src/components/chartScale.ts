// グラフの目盛りと数値・日時の書式。検体検査の時系列(LabTimelineChart)と
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
export function niceTicks(min: number, max: number): number[] {
  if (min === max) {
    // 全点が同じ値のときは値を中央に置ける適当な幅をとる。
    const pad = Math.abs(min) || 1;
    min -= pad / 2;
    max += pad / 2;
  }
  const rawStep = (max - min) / 4;
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
