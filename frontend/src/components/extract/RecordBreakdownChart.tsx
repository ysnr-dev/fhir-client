import { useState } from "react";
import type { RecordBreakdown } from "../../fhir/recordBreakdownHelpers";

interface Props {
  breakdown: RecordBreakdown;
  /** 行の軸が期間のときだけ描く(期間ごとの件数・集計値の推移)。 */
  periodOnRows: boolean;
}

/** 日付の無い行と、軸が無いときの「計」の行は棒にしない。 */
const SKIP = new Set(["(なし)", "計"]);

/**
 * 内訳の期間の推移(docs/data-extract-design.md §18)。行の軸が期間のとき、行ごとの件数か集計値を 1 系列の棒にする。
 * 系列が 1 つなので凡例は持たず、見出しで何の値かを示す。数は下の表にもある(表が棒の読み替え)。
 */
export function RecordBreakdownChart({ breakdown, periodOnRows }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  if (!periodOnRows) return null;
  const withValue = breakdown.valueLabel !== null;
  const bars = breakdown.rowLabels
    .map((label, r) => ({
      label,
      value: withValue ? (breakdown.rowTotals[r].value ?? 0) : breakdown.rowTotals[r].records,
      records: breakdown.rowTotals[r].records,
    }))
    .filter((bar) => !SKIP.has(bar.label));
  if (bars.length < 2) return null;
  const max = Math.max(...bars.map((bar) => bar.value), 0);
  if (max <= 0) return null;
  // 目盛りの文字が重ならないよう、最初・真ん中・最後だけに期間の名前を出す。
  const labeled = new Set([0, Math.floor((bars.length - 1) / 2), bars.length - 1]);
  const title = withValue ? breakdown.valueLabel : "件数";

  return (
    <figure className="extract-breakdown-chart" aria-label={`${title}の推移`}>
      <figcaption className="extract-breakdown-chart__title">
        {`${title}の推移`}
        <span className="extract-breakdown-chart__max">{`最大 ${max}`}</span>
      </figcaption>
      <div className="extract-breakdown-chart__plot" onMouseLeave={() => setHover(null)}>
        {bars.map((bar, i) => (
          <div
            key={bar.label}
            className="extract-breakdown-chart__slot"
            onMouseEnter={() => setHover(i)}
            aria-label={`${bar.label} ${bar.value}`}
          >
            <div
              className={`extract-breakdown-chart__bar${hover === i ? " is-hover" : ""}`}
              style={{ height: `${(bar.value / max) * 100}%` }}
            />
            {hover === i && (
              <div className="extract-breakdown-chart__tooltip" role="tooltip">
                <strong>{bar.label}</strong>
                <span>{withValue ? `${title} ${bar.value}(${bar.records} 件)` : `${bar.value} 件`}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="extract-breakdown-chart__axis">
        {bars.map((bar, i) => (
          <span key={bar.label} className="extract-breakdown-chart__tick">
            {labeled.has(i) ? bar.label : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}
