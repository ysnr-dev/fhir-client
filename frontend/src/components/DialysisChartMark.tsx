import { ChartIcon } from "./icons/ChartIcon";

// 透析の回に経過表があることの印(docs/dialysis-chart-design.md §3.1)。透析一覧とカルテの実施の行に添える。
export function DialysisChartMark() {
  return (
    <span className="dialysis-chart-mark" role="img" title="経過表あり" aria-label="経過表あり">
      <ChartIcon />
    </span>
  );
}
