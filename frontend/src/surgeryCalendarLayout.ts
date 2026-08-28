// 手術室カレンダーの左右分割(格子 / 未確定リスト)のスプリッタ位置の保存。
// カルテのペース分割(karteLayout.ts)と同じ作りで、日ビュー・週ビューで共有する。

const GRID_RATIO_STORAGE_KEY = "fhir-client.surgeryCalendar.gridWidthRatio";

// どちらのペインも潰れないよう、格子側が占める比率を制限する。
// 既定は格子 74%(手術室 3 部屋ぶんの列幅と、カード 1 枚が読める右ペインの折り合い)。
const MIN_GRID_RATIO = 0.4;
const MAX_GRID_RATIO = 0.9;
export const DEFAULT_GRID_RATIO = 0.74;

export function clampGridRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_GRID_RATIO;
  return Math.min(MAX_GRID_RATIO, Math.max(MIN_GRID_RATIO, ratio));
}

export function readGridRatio(): number {
  try {
    const value = localStorage.getItem(GRID_RATIO_STORAGE_KEY);
    return value ? clampGridRatio(Number(value)) : DEFAULT_GRID_RATIO;
  } catch {
    // プライベートブラウズ等で localStorage が使えない場合は既定の幅にする。
    return DEFAULT_GRID_RATIO;
  }
}

export function storeGridRatio(ratio: number) {
  try {
    localStorage.setItem(GRID_RATIO_STORAGE_KEY, String(clampGridRatio(ratio)));
  } catch {
    // 保存できなくてもその場の表示は変える。
  }
}
