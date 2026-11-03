// 重要日の旗アイコン。filled で旗を塗りつぶす(輪郭だけの旗と形で区別する)。
export function FlagIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M3.5 14.5V2M3.5 2.5h8.5l-2.2 3 2.2 3H3.5"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
