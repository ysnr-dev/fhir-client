// テーマ(ライト/ダーク)の保存と適用。
// CSS 側は :root[data-theme="dark"] だけを見るため、OS 設定に従う場合でも
// 解決済みの light / dark を必ず属性に書き込む。
export type Theme = "light" | "dark";

// index.html の起動時スクリプトでも同じキーを読む(初回描画のちらつき防止)。
// 変更する場合は両方揃えること。
export const THEME_STORAGE_KEY = "fhir-client.theme";

// 保存済みの明示選択。未選択(= OS 設定に従う)なら null。
export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // プライベートブラウズ等で localStorage が使えない場合は OS 設定にフォールバックする。
    return null;
  }
}

export function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 保存できなくてもその場の表示は切り替える。
  }
}

export function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(): Theme {
  return readStoredTheme() ?? systemTheme();
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}
