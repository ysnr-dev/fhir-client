// カルテ画面の左ペインの表示モードと、上下分割時のスプリッタ位置の保存。
// tabs: カルテと他タブを 1 つの領域で切り替える(既定)
// split: 上にカルテ、下にそれ以外のタブを同時に表示する
export type KarteLeftPaneMode = "tabs" | "split";

const MODE_STORAGE_KEY = "fhir-client.karte.leftPaneMode";
const TOP_RATIO_STORAGE_KEY = "fhir-client.karte.leftPaneTopRatio";

// 上下どちらのペインも潰れないように、上ペインが占める比率を制限する。
const MIN_TOP_RATIO = 0.2;
const MAX_TOP_RATIO = 0.85;
export const DEFAULT_TOP_RATIO = 0.6;

export function clampTopRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_TOP_RATIO;
  return Math.min(MAX_TOP_RATIO, Math.max(MIN_TOP_RATIO, ratio));
}

export function readLeftPaneMode(): KarteLeftPaneMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === "split" ? "split" : "tabs";
  } catch {
    // プライベートブラウズ等で localStorage が使えない場合は既定のモードにする。
    return "tabs";
  }
}

export function storeLeftPaneMode(mode: KarteLeftPaneMode) {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // 保存できなくてもその場の表示は切り替える。
  }
}

export function readTopRatio(): number {
  try {
    const value = localStorage.getItem(TOP_RATIO_STORAGE_KEY);
    return value ? clampTopRatio(Number(value)) : DEFAULT_TOP_RATIO;
  } catch {
    return DEFAULT_TOP_RATIO;
  }
}

export function storeTopRatio(ratio: number) {
  try {
    localStorage.setItem(TOP_RATIO_STORAGE_KEY, String(clampTopRatio(ratio)));
  } catch {
    // 保存できなくてもその場の表示は変える。
  }
}
