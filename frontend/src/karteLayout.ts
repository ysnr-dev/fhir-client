// カルテ画面の左ペインの表示モードと、各スプリッタ位置の保存。
// tabs: カルテと他タブを 1 つの領域で切り替える(既定)
// split: 上にカルテ、下にそれ以外のタブを同時に表示する
export type KarteLeftPaneMode = "tabs" | "split";

const MODE_STORAGE_KEY = "fhir-client.karte.leftPaneMode";
const TOP_RATIO_STORAGE_KEY = "fhir-client.karte.leftPaneTopRatio";
const LEFT_WIDTH_RATIO_STORAGE_KEY = "fhir-client.karte.leftPaneWidthRatio";
const DAY_LIST_STORAGE_KEY = "fhir-client.karte.dayListVisible";
const PROBLEM_LIST_STORAGE_KEY = "fhir-client.karte.problemListVisible";

// 上下どちらのペインも潰れないように、上ペインが占める比率を制限する。
const MIN_TOP_RATIO = 0.2;
const MAX_TOP_RATIO = 0.85;
export const DEFAULT_TOP_RATIO = 0.6;

// 左右も同様に制限する。既定は右ペイン 44%(スプリッタ導入前の固定値)。
const MIN_LEFT_WIDTH_RATIO = 0.3;
const MAX_LEFT_WIDTH_RATIO = 0.75;
export const DEFAULT_LEFT_WIDTH_RATIO = 0.56;

export function clampTopRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_TOP_RATIO;
  return Math.min(MAX_TOP_RATIO, Math.max(MIN_TOP_RATIO, ratio));
}

export function clampLeftWidthRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_LEFT_WIDTH_RATIO;
  return Math.min(MAX_LEFT_WIDTH_RATIO, Math.max(MIN_LEFT_WIDTH_RATIO, ratio));
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

export function readLeftWidthRatio(): number {
  try {
    const value = localStorage.getItem(LEFT_WIDTH_RATIO_STORAGE_KEY);
    return value ? clampLeftWidthRatio(Number(value)) : DEFAULT_LEFT_WIDTH_RATIO;
  } catch {
    return DEFAULT_LEFT_WIDTH_RATIO;
  }
}

export function storeLeftWidthRatio(ratio: number) {
  try {
    localStorage.setItem(LEFT_WIDTH_RATIO_STORAGE_KEY, String(clampLeftWidthRatio(ratio)));
  } catch {
    // 保存できなくてもその場の表示は変える。
  }
}

// カルテタブの診療日パネルの表示・非表示。既定は表示。
export function readDayListVisible(): boolean {
  try {
    return localStorage.getItem(DAY_LIST_STORAGE_KEY) !== "hidden";
  } catch {
    return true;
  }
}

export function storeDayListVisible(visible: boolean) {
  try {
    localStorage.setItem(DAY_LIST_STORAGE_KEY, visible ? "visible" : "hidden");
  } catch {
    // 保存できなくてもその場の表示は切り替える。
  }
}

// カルテタブのプロブレムリストの表示・非表示。既定は表示。
export function readProblemListVisible(): boolean {
  try {
    return localStorage.getItem(PROBLEM_LIST_STORAGE_KEY) !== "hidden";
  } catch {
    return true;
  }
}

export function storeProblemListVisible(visible: boolean) {
  try {
    localStorage.setItem(PROBLEM_LIST_STORAGE_KEY, visible ? "visible" : "hidden");
  } catch {
    // 保存できなくてもその場の表示は切り替える。
  }
}
