import { Modal } from "./Modal";

// 層別の要約の使い方。層別の要約のモーダルの見出しの「?」から開く。
// 見た目はマルチチャートの見方(PatientChartGuide)と同じクラスを使う。

export function ChartStratifyGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="層別の要約の使い方" onClose={onClose} className="modal--wide">
      <div className="patient-chart__guide">
        <section>
          <h3>何を見るか</h3>
          <p>
            期間を「層」(症状の程度・薬の用量・入院中かどうか など)で分け、各項目の値を層ごとにまとめて並べます。「症状が重い時期は BNP が高い」「増量後は HbA1c が下がった」のような、チャートを目で見て受けた印象を数で確かめるための表です。対象はマルチチャートで表示している期間の記録です。
          </p>
        </section>

        <section>
          <h3>層にできるもの</h3>
          <ul className="patient-chart__guide-text">
            <li>選択肢の項目(浮腫の程度・NYHA 分類・尿蛋白の定性など): 記録した日から次の記録までをその選択肢の時期とみなします。最初の記録より前の値は数えません。</li>
            <li>追う薬剤: 1 日量ごとに分け、飲んでいない時期は「服用なし」にします。</li>
            <li>入退院: 「入院中」と「入院外」。</li>
            <li>化学療法: 「クール中」と「クール外」(クールごとには分けません)。</li>
            <li>有害事象: Grade ごとに分け、無い時期は「なし」にします。同じ時期に複数あれば高い方の Grade に入れます。</li>
            <li>基準日を置いているときは「基準日の前後」も選べます。</li>
          </ul>
          <p>最初はチャートで網掛けにしている行が選ばれています。</p>
        </section>

        <section>
          <h3>表の見方</h3>
          <ul className="patient-chart__guide-text">
            <li>行が項目(血圧は収縮期・拡張期の 2 行)、列が層です。記録が 1 件も無い層の列は出しません。</li>
            <li>n: その層に入った記録の数。</li>
            <li>中央値・範囲: その層の値の真ん中と、最小〜最大。</li>
            <li>基準外: H・L などの判定が付いた記録の割合。判定を持たない項目(テンプレート)は「—」です。</li>
          </ul>
        </section>

        <section>
          <h3>読むときの目安</h3>
          <ul className="patient-chart__guide-text">
            <li>層どうしで中央値を比べ、範囲の重なり具合も見ます。範囲が大きく重なっていれば、差ははっきりしません。</li>
            <li>n が少ない層(数件)の中央値は、1 件の値で大きく動きます。</li>
          </ul>
        </section>

        <section>
          <h3>使い方の例</h3>
          <ul className="patient-chart__guide-text">
            <li>NYHA 分類で層にして、BNP・体重を比べる。</li>
            <li>尿蛋白の定性で層にして、Cre の値を比べる。</li>
            <li>有害事象で層にして、Grade 3 の時期の白血球数を見る。</li>
            <li>薬剤の用量で層にして、増量の前後の検査値を比べる。</li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}
