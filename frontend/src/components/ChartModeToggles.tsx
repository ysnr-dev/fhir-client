// グラフの見え方の切り替え(マルチチャートと検体検査時系列のグラフで共通)。

/**
 * 項目ごとに分けて並べるか、1 つのグラフに重ねるかの切り替え。
 * アイコンは「横罫で区切った 2 段」と「重なった 2 本の線」。
 */
export function OverlayToggle({ overlay, onToggle }: { overlay: boolean; onToggle: () => void }) {
  const label = overlay ? "項目ごとに分けて表示" : "すべてを 1 つのグラフに重ねて表示";
  return (
    <button
      type="button"
      className={`patient-chart__mode${overlay ? " is-active" : ""}`}
      aria-pressed={overlay}
      title={label}
      aria-label={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        {overlay ? (
          // 重ねる: 1 つの枠の中で 2 本の線が交わる。
          <>
            <path d="M3.5 11.5 6.5 7 9.5 9.5 12.5 5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.5 6 6.5 9.5 9.5 5.5 12.5 10.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
          </>
        ) : (
          // 分ける: 枠を横罫で 2 段に割り、それぞれに線を 1 本ずつ。
          <>
            <path d="M1.5 8h13" stroke="currentColor" strokeWidth="1.2" />
            <path d="M3.5 6 6.5 4.5 9.5 6.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.5 12 6.5 10 9.5 12 12.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
      </svg>
    </button>
  );
}

/** グラフ上に数値を出すかどうかの切り替え。アイコンは枠の中に数字。 */
export function ValuesToggle({ values, onToggle }: { values: boolean; onToggle: () => void }) {
  const label = values ? "数値を隠す" : "グラフ上に数値を出す";
  return (
    <button
      type="button"
      className={`patient-chart__mode${values ? " is-active" : ""}`}
      aria-pressed={values}
      title={label}
      aria-label={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <text x="8" y="11.5" textAnchor="middle" fontSize="8" fill="currentColor">
          12
        </text>
      </svg>
    </button>
  );
}

/**
 * 1 グラフあたりの高さを 1 段ずつ変える。アイコンは枠の中の上下の矢印
 * (低く: 内向き / 高く: 外向き)。端の段では押せない。
 */
export function HeightStepButtons({
  step,
  maxStep,
  onChange,
}: {
  step: number;
  maxStep: number;
  onChange: (step: number) => void;
}) {
  return (
    <>
      <button
        type="button"
        className="patient-chart__mode"
        title="グラフを低くする"
        aria-label="グラフを低くする"
        disabled={step <= 0}
        onClick={() => onChange(step - 1)}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 3.5v3M6 4.8 8 6.8l2-2M8 12.5v-3M6 11.2l2-2 2 2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="patient-chart__mode"
        title="グラフを高くする"
        aria-label="グラフを高くする"
        disabled={step >= maxStep}
        onClick={() => onChange(step + 1)}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 4v8M6 6l2-2 2 2M6 10l2 2 2-2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </>
  );
}
