import { useState } from "react";
import { Modal } from "./Modal";

// レジメンマスタの使い方。一覧と編集画面の見出しの「?」から開く。
// 中身は docs/chemo-regimen-design.md の利用者向けの要約で、話題ごとに分け、左の一覧で切り替える。
// 見た目はデータ抽出の使い方(DataExtractGuide)と同じクラスを使う。機能を足したらここも直す。

type Topic = "overview" | "schedule" | "dose" | "criteria" | "approval" | "revise";

const TOPICS: { key: Topic; label: string }[] = [
  { key: "overview", label: "登録の流れ" },
  { key: "schedule", label: "スケジュール" },
  { key: "dose", label: "投与内容" },
  { key: "criteria", label: "適応基準・副作用" },
  { key: "approval", label: "承認の条件" },
  { key: "revise", label: "承認済を直す" },
];

function TopicBody({ topic }: { topic: Topic }) {
  switch (topic) {
    case "overview":
      return (
        <>
          <p className="extract-guide__lead">
            レジメンは化学療法の治療計画の雛形です。カルテの右ペインの「化学療法」で患者に適用すると、体格から投与量を出して注射・処方のオーダーに展開します。
          </p>

          <section>
            <h3>流れ</h3>
            <ol className="extract-guide__steps">
              <li>
                <strong>下書きを作る</strong>「レジメン追加」で基本情報・スケジュール・投与内容を入れて保存します。書きかけでも保存できます。
              </li>
              <li>
                <strong>確かめる</strong>Day 表で、どの日に何を投与するかを見直します。
              </li>
              <li>
                <strong>承認する</strong>「運用」の状態を承認済にして保存します。患者に適用できるのは承認済だけです。
              </li>
              <li>
                <strong>廃止する</strong>使うのをやめるときは廃止にします。廃止は下書きに戻せません。
              </li>
            </ol>
          </section>

          <section>
            <h3>状態</h3>
            <table className="extract-guide__table">
              <tbody>
                <tr>
                  <th>下書き</th>
                  <td>自由に編集・削除できる。患者には適用できない</td>
                </tr>
                <tr>
                  <th>承認済</th>
                  <td>患者に適用できる。内容は変更できない</td>
                </tr>
                <tr>
                  <th>廃止</th>
                  <td>適用の候補に出ない。内容は変更できない</td>
                </tr>
              </tbody>
            </table>
          </section>
        </>
      );
    case "schedule":
      return (
        <>
          <section>
            <h3>1 クール</h3>
            <p className="extract-guide__lead">1 クール = 投与期間 + 休薬期間(投与 3 日・休薬 11 日なら 14 日)。</p>
          </section>

          <section>
            <h3>項目</h3>
            <dl className="extract-guide__terms">
              <dt>投与期間</dt>
              <dd>Day 1 から投与が続く日数</dd>
              <dt>休薬期間</dt>
              <dd>投与期間のあと、次のクールまで休む日数</dd>
              <dt>予定クール数</dt>
              <dd>患者に適用するときの初期値</dd>
            </dl>
          </section>

          <div className="extract-guide__note">
            <h3>保存できないもの</h3>
            <ul>
              <li>1 クールを超える投与日(14 日のクールに Day 20 など)</li>
              <li>1 クールをはみ出す内服(Day 1 から 14 日分を 7 日のクールに入れる など)</li>
            </ul>
          </div>
        </>
      );
    case "dose":
      return (
        <>
          <section>
            <h3>ステップ</h3>
            <p>
              注射オーダーの RP(一緒に混ぜて落とす単位)にあたります。上から投与順に並べ、投与日(1,8,15 のようにカンマ区切りの Day)、点滴 / ワンショット / 内服、経路・手技・ライン・点滴時間を持ちます。
            </p>
          </section>

          <section>
            <h3>算出基準</h3>
            <table className="extract-guide__table">
              <tbody>
                <tr>
                  <th>体表面積(/m²)</th>
                  <td>基準値 × 体表面積(85 mg/m² × 1.6 m² = 136 mg)</td>
                </tr>
                <tr>
                  <th>体重(/kg)</th>
                  <td>基準値 × 体重</td>
                </tr>
                <tr>
                  <th>AUC</th>
                  <td>Calvert 式: AUC × (GFR + 25)。単位は mg</td>
                </tr>
                <tr>
                  <th>固定量</th>
                  <td>基準値のまま(mg/body)</td>
                </tr>
                <tr>
                  <th>製剤単位</th>
                  <td>袋・瓶などの数(補液の 1 袋 など)</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h3>入れ方</h3>
            <dl className="extract-guide__terms">
              <dt>上限値</dt>
              <dd>計算した量がこれを超えないように抑える</dd>
              <dt>内服</dt>
              <dd>基準値は 1 日量で入れる</dd>
              <dt>単位</dt>
              <dd>その薬剤の投与量換算マスタにある単位から選ぶ。換算が無い薬剤は自由入力</dd>
            </dl>
          </section>
        </>
      );
    case "criteria":
      return (
        <>
          <section>
            <h3>適応基準(検査結果値)</h3>
            <p>
              適用と次クールの登録の画面で、患者の直近の検査結果と並べて基準外かどうかを出します。基準外でも登録は止めません。
            </p>
            <dl className="extract-guide__terms">
              <dt>検査項目</dt>
              <dd>「選択」で検査項目マスタから選ぶと、分析物(JLAC11)と単位が入る</dd>
              <dt>CCr・eGFR</dt>
              <dd>分析物を入れず、名称で登録する(体格と検査値から計算する)</dd>
            </dl>
          </section>

          <section>
            <h3>適用の画面に出るもの</h3>
            <dl className="extract-guide__terms">
              <dt>副作用</dt>
              <dd>想定されるものを CTCAE の用語と Grade で登録する</dd>
              <dt>基準の文章</dt>
              <dd>適応の補足・中止基準・減量基準</dd>
              <dt>参考文献</dt>
              <dd>レジメンの出典</dd>
            </dl>
          </section>
        </>
      );
    case "approval":
      return (
        <>
          <p className="extract-guide__lead">
            承認済にして保存するときに確かめます。満たさないときは、足りないものが画面の上に出ます。
          </p>

          <section>
            <h3>条件</h3>
            <table className="extract-guide__table">
              <tbody>
                <tr>
                  <th>ステップ</th>
                  <td>1 つ以上あり、どのステップにも薬剤がある</td>
                </tr>
                <tr>
                  <th>基準値・単位</th>
                  <td>どの薬剤にもある</td>
                </tr>
                <tr>
                  <th>換算</th>
                  <td>単位から製剤数に直す換算が投与量換算マスタにある(製剤単位が基準の薬剤は除く)</td>
                </tr>
                <tr>
                  <th>医薬品</th>
                  <td>薬価基準から削除・経過措置になった医薬品を含まない</td>
                </tr>
              </tbody>
            </table>
          </section>

          <div className="extract-guide__note">
            <h3>換算が無いと言われたら</h3>
            <ul>
              <li>マスタメンテの「投与量換算」で、その薬剤に単位の換算(1 瓶 = 100 mg など)を登録してから承認します。</li>
              <li>承認日と承認者は、保存したときに自動で入ります。</li>
            </ul>
          </div>
        </>
      );
    case "revise":
      return (
        <>
          <p className="extract-guide__lead">
            承認済・廃止のレジメンは内容を変更できません。過去に適用したオーダーの根拠が変わらないようにするためです。状態・有効期間・表示順だけは変更できます。
          </p>

          <section>
            <h3>直し方</h3>
            <ol className="extract-guide__steps">
              <li>
                <strong>複製する</strong>「複製」で新しいコードの下書きを作ります。複製元は見出しの下に出ます。
              </li>
              <li>
                <strong>直して承認する</strong>複製した下書きを直し、承認済にします。
              </li>
              <li>
                <strong>元を廃止する</strong>元のレジメンの状態を廃止にします。
              </li>
            </ol>
          </section>

          <div className="extract-guide__note">
            <h3>まだ適用していなければ</h3>
            <ul>
              <li>一度も患者に適用していない承認済は、状態を下書きに戻して直せます。</li>
            </ul>
          </div>
        </>
      );
  }
}

export function RegimenGuide({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState<Topic>("overview");
  return (
    <Modal title="レジメンマスタの使い方" onClose={onClose} className="modal--wide">
      <div className="extract-guide__layout">
        <nav className="extract-guide__nav" aria-label="使い方の話題">
          {TOPICS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`extract-guide__nav-item${current === item.key ? " is-active" : ""}`}
              aria-current={current === item.key ? "true" : undefined}
              onClick={() => setCurrent(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="extract-guide">
          <TopicBody topic={current} />
        </div>
      </div>
    </Modal>
  );
}
