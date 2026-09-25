// 画面で使う小さな統計。要約は中央値と範囲に留め、検定(p 値)は出さない。

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 順位(1 始まり)。同じ値は平均順位にする(Spearman の同順位の扱い)。 */
export function averageRanks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k].index] = rank;
    i = j + 1;
  }
  return ranks;
}

/** Spearman の順位相関係数。3 組未満、またはどちらかが定数なら求めない。 */
export function spearman(xs: number[], ys: number[]): number | undefined {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return undefined;
  const rx = averageRanks(xs.slice(0, n));
  const ry = averageRanks(ys.slice(0, n));
  const mean = (n + 1) / 2;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = rx[i] - mean;
    const dy = ry[i] - mean;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return undefined;
  return sxy / Math.sqrt(sxx * syy);
}
