import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { DialysisChartPanel } from "../components/DialysisChartPanel";
import { useDialysisChartReturnTo } from "../returnTo";

// 透析経過表(透析中の時系列記録)のページ。docs/dialysis-chart-design.md。
//
// 透析中は開きっぱなしにして 1 点ずつ足していくので、グラフ + 表 + 入力を
// 広く置けるページを本体にしてある(カルテからはモーダルでも開ける)。

export function DialysisChartPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  // ボードからもベッドサイドの表からも開くので、戻り先は開いた画面に合わせる。
  const returnTo = useDialysisChartReturnTo();

  // 列・グラフが横に伸びるので、この画面だけ幅を広げる(透析一覧と同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  return (
    // .time-chart は入力欄の見た目をこの中に閉じて当てるための印。
    <div className="page time-chart">
      <div className="page__header">
        <h1>透析経過表</h1>
        <Link to={returnTo}>← 戻る</Link>
      </div>

      <DialysisChartPanel sessionId={sessionId} showPatientHeader />
    </div>
  );
}
