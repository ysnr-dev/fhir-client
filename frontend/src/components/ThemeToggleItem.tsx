import { useTheme } from "../hooks/useTheme";

// 管理メニュー内のダークモード切替。連続して切り替えられるよう、
// クリックしてもメニューを閉じない(HoverMenu のクリックで閉じる挙動を止める)。
export function ThemeToggleItem() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="row-menu__item theme-toggle"
      role="menuitemcheckbox"
      aria-checked={isDark}
      onClick={(event) => {
        event.stopPropagation();
        toggleTheme();
      }}
    >
      <span>ダークモード</span>
      <span className="theme-toggle__state" aria-hidden="true">
        {isDark ? "ON" : "OFF"}
      </span>
    </button>
  );
}
