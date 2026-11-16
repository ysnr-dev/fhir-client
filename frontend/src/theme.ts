import { useEffect } from "react";

// 画面はダークテーマで描き、紙に出すもの(印刷用の別タブとブラウザの印刷)だけライトで描く。
// CSS は :root がライト(紙面)、:root[data-theme="dark"] が画面の配色。
// 起動時の data-theme="dark" は index.html の <html> に書いてある。
type Theme = "light" | "dark";

let screenTheme: Theme = "dark";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

// 印刷用の別タブを開いている間は、画面上の紙面もライトで描く。
export function usePrintPageTheme() {
  useEffect(() => {
    screenTheme = "light";
    applyTheme("light");
    return () => {
      screenTheme = "dark";
      applyTheme("dark");
    };
  }, []);
}

// どの画面からブラウザの印刷をしても、紙面はライトで出す。起動時に 1 回呼ぶ。
export function installPrintTheme() {
  window.addEventListener("beforeprint", () => applyTheme("light"));
  window.addEventListener("afterprint", () => applyTheme(screenTheme));
}
