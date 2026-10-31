// 医薬品を選ぶボタンのカプセル剤アイコン。片側を塗って、2 色に分かれたカプセルに見せる。
export function PillIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <g transform="rotate(-45 8 8)" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
        <path d="M8 4.75H4.75a3.25 3.25 0 0 0 0 6.5H8Z" fill="currentColor" />
        <rect x="1.5" y="4.75" width="13" height="6.5" rx="3.25" fill="none" />
      </g>
    </svg>
  );
}
