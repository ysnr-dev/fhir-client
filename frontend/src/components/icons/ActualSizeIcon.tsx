// 画像を原寸大で表示するアイコン(1:1)。
export function ActualSizeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M1.5 2.5h13v11h-13zM4.5 6l1.2-.8V11M10.5 6l1.2-.8V11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="7" r="0.7" fill="currentColor" />
      <circle cx="8" cy="9.6" r="0.7" fill="currentColor" />
    </svg>
  );
}
