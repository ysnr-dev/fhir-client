import { Modal } from "./Modal";

// 対比(散布図)の使い方。対比のモーダルの見出しの「?」から開く。
// 見た目はマルチチャートの見方(PatientChartGuide)と同じクラスを使う。

export function ChartScatterGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="対比の使い方" onClose={onClose} className="modal--wide">
      <div className="patient-chart__guide">
        <section>
          <h3>何を見るか</h3>
          <p>
            2 つの項目の記録を同じ時期どうしで組にして散布図に描き、片方が上がるともう片方がどう動くか(関係の向きと強さ)を見ます。対象はマルチチャートで表示している期間の記録です。
          </p>
        </section>

        <section>
          <h3>選ぶもの</h3>
          <ul className="patient-chart__guide-text">
            <li>
              横軸: 数値の項目か、選択肢の項目(浮腫の程度・NYHA 分類・尿蛋白の定性など)。選択肢は並び順(軽い → 重い)に置き、目盛りは選択肢の名前で出します。
            </li>
            <li>縦軸: 数値の項目。</li>
            <li>
              記録の対応: 「同じ日」は同じ日の記録だけを組にします。「±3 日」などは、横軸の記録ごとにその幅の中で最も近い縦軸の記録を 1 つ当てます(1 つの記録は 1 回しか使いません)。採血と記入の日がずれる項目は幅を広げてください。
            </li>
          </ul>
        </section>

        <section>
          <h3>点の見方</h3>
          <ul className="patient-chart__guide-text">
            <li>点 1 つが記録の組 1 つです。古い記録ほど薄く、新しい記録ほど濃く描きます。</li>
            <li>点にカーソルを合わせると、両方の値と日付(基準日があれば基準からの日数)が出ます。</li>
          </ul>
        </section>

        <section>
          <h3>数値の読み方</h3>
          <ul className="patient-chart__guide-text">
            <li>n は組の数です。</li>
            <li>
              Spearman の ρ は、値の大小の順位がどれだけ揃って動くかを −1〜1 で表します。1 に近いほど「横軸が大きいと縦軸も大きい」、−1 に近いほど「横軸が大きいと縦軸は小さい」、0 付近は一方向の関係が見えないことを示します。直線でなくても、一方向に動いていれば大きくなります。
            </li>
            <li>n が 10 未満のときは目安になりません。組が 3 未満か、どちらかの値が一度も変わらないときは ρ を出しません。</li>
          </ul>
        </section>

        <section>
          <h3>使い方の例</h3>
          <ul className="patient-chart__guide-text">
            <li>NYHA 分類(選択肢)× BNP: 症状が重い記録ほど BNP が高いか。</li>
            <li>尿蛋白の定性(選択肢)× Cre: 尿蛋白が多い時期に Cre が高いか。</li>
            <li>体重 × 血圧、HbA1c × 血糖 など、数値どうしの関係。</li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}
