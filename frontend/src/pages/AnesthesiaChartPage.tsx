import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { AnesthesiaChartPanel } from "../components/AnesthesiaChartPanel";

// 麻酔チャート(術中リアルタイム記録)のページ。docs/anesthesia-chart-design.md。
//
// 手術中は開きっぱなしにして 1 点ずつ足していくので、グラフ + 表 + 3 種の入力を
// 広く置けるページを本体にしてある(カルテからはモーダルでも開ける)。

export function AnesthesiaChartPage() {
  const { orderId } = useParams<{ orderId: string }>();

  // 列・グラフが横に伸びるので、この画面だけ幅を広げる(手術一覧と同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  return (
    // .page は見出し・本文の基本の型(h1 のサイズもここで決まる)。
    // .anes-chart は入力欄の見た目をこの中に閉じて当てるための印。
    <div className="page anes-chart">
      <div className="page__header">
        <h1>麻酔チャート</h1>
        <Link to="/surgery-worklist">← 手術一覧</Link>
      </div>

      <AnesthesiaChartPanel orderId={orderId} showPatientHeader />
    </div>
  );
}
