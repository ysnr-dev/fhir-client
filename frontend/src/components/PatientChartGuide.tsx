import type { ReactNode } from "react";
import { Modal } from "./Modal";

// マルチチャートの見方。縦線・印・色の意味を、実際の描画と同じクラスで描いた見本と並べて説明する
// (見本の色がグラフとずれない。ダークテーマでも同じ見え方になる)。

const W = 36;
const H = 18;

function Sample({ children }: { children: ReactNode }) {
  return (
    <svg className="patient-chart__guide-sample" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      {children}
    </svg>
  );
}

function VLine({ className }: { className: string }) {
  return <line className={className} x1={W / 2} x2={W / 2} y1={1} y2={H - 1} />;
}

function Row({ sample, children }: { sample: ReactNode; children: ReactNode }) {
  return (
    <li>
      {sample}
      <span>{children}</span>
    </li>
  );
}

export function PatientChartGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="マルチチャートの見方" onClose={onClose} className="modal--wide">
      <div className="patient-chart__guide">
        <section>
          <h3>画面の構成</h3>
          <p>
            上段がイベントの帯(病名・入退院・手術・化学療法などと、追う薬剤・選択肢の項目の行)、下段が項目ごとのグラフです。横軸はすべての段で共通で、右端が基準日(既定は今日)です。同じ縦の位置が同じ時期を表します。
          </p>
        </section>

        <section>
          <h3>縦線</h3>
          <ul>
            <Row sample={<Sample><VLine className="patient-chart__column-grid" /></Sample>}>
              列(日・月・年)の区切り
            </Row>
            <Row sample={<Sample><VLine className="patient-chart__today" /></Sample>}>今日</Row>
            <Row
              sample={
                <Sample>
                  <VLine className="patient-chart__event-line patient-chart__event--condition" />
                </Sample>
              }
            >
              病名の疑い・確定・開始・転帰の日(帯の病名の色)
            </Row>
            <Row
              sample={
                <Sample>
                  <VLine className="patient-chart__event-line patient-chart__event--surgery" />
                </Sample>
              }
            >
              手術・入退院の日(帯のそれぞれの色)
            </Row>
            <Row
              sample={
                <Sample>
                  <VLine className="patient-chart__event-line patient-chart__event--drug" />
                </Sample>
              }
            >
              追う薬剤の開始・用量の変わり目・途切れた日
            </Row>
            <Row
              sample={
                <Sample>
                  <VLine className="patient-chart__event-line patient-chart__event--anchor" />
                </Sample>
              }
            >
              基準日(点や印から「基準日に設定」した日)
            </Row>
            <Row
              sample={
                <Sample>
                  <g className="patient-chart__segment-break">
                    <line x1={W / 2} x2={W / 2} y1={7} y2={H - 1} />
                    <path d={`M${W / 2},0 L${W / 2 + 3.5},3.5 L${W / 2},7 L${W / 2 - 3.5},3.5 Z`} />
                  </g>
                </Sample>
              }
            >
              検査の単位・測定法・JLAC11 が変わった所。前後の値はそのまま比べられないので線をつなぎません。◆にカーソルを当てると何が変わったかが出ます
            </Row>
          </ul>
        </section>

        <section>
          <h3>グラフ</h3>
          <ul>
            <Row
              sample={
                <Sample>
                  <rect className="patient-chart__ref-band" x={0} y={4} width={W} height={10} />
                </Sample>
              }
            >
              基準範囲(検査結果に書かれた範囲。項目ごとの表示で、線が 1 本のグラフだけ)
            </Row>
            <Row
              sample={
                <Sample>
                  <circle className="patient-chart__flag patient-chart__flag--high" cx={10} cy={9} r={6} />
                  <circle className="lab-chart__marker" cx={10} cy={9} r={3.5} />
                  <circle className="patient-chart__flag patient-chart__flag--low" cx={27} cy={9} r={6} />
                  <circle className="lab-chart__marker" cx={27} cy={9} r={3.5} />
                </Sample>
              }
            >
              輪で囲んだ点は基準外(赤は高値 H、青は低値 L)。輪が太いものはパニック値です。バイタルは施設のしきい値で判定します
            </Row>
          </ul>
          <p>
            「まとめて 1 つ」の表示では、各項目を自分の値の範囲で上下いっぱいにそろえて重ねます。縦軸に数値は出さず、実際の値と範囲は凡例とツールチップで読みます。凡例を押すとその項目を一時的に隠せます。
          </p>
        </section>

        <section>
          <h3>イベントの帯</h3>
          <ul>
            <Row
              sample={
                <Sample>
                  <g className="patient-chart__event--exam">
                    <path className="patient-chart__marker" d={`M${W / 2 - 4},4 L${W / 2 + 4},4 L${W / 2},12 Z`} />
                  </g>
                </Sample>
              }
            >
              その日のできごと(手術・検査実施・注射実施、頓用・外用・注射の薬剤、病名)
            </Row>
            <Row
              sample={
                <Sample>
                  <g className="patient-chart__event--chemo">
                    <rect className="patient-chart__bar" x={2} y={4} width={W - 4} height={10} rx={2} />
                  </g>
                </Sample>
              }
            >
              期間(入院・化学療法のクール・放射線治療・処方の服用期間)
            </Row>
            <Row
              sample={
                <Sample>
                  <g className="patient-chart__drug">
                    <rect className="patient-chart__bar" x={2} y={4} width={W - 4} height={10} rx={2} />
                  </g>
                  <path className="patient-chart__dose-change patient-chart__dose-change--increase" d="M4,13 L12,13 L8,5 Z" />
                </Sample>
              }
            >
              追う薬剤。同じ 1 日量で飲んでいた期間が 1 本で、頭の ▲ は増量、▼ は減量です。処方と処方の間が 7 日以内なら続けて飲んでいたとみなしてつなぎます
            </Row>
            <Row
              sample={
                <Sample>
                  <g className="patient-chart__choice">
                    <rect className="patient-chart__level patient-chart__level--0" x={3} y={4} width={7} height={10} rx={1.5} />
                    <rect className="patient-chart__level patient-chart__level--2" x={14} y={4} width={7} height={10} rx={1.5} />
                    <rect className="patient-chart__level patient-chart__level--4" x={25} y={4} width={7} height={10} rx={1.5} />
                  </g>
                </Sample>
              }
            >
              選択肢の項目(症状の程度など)。選択肢の並び順が後ろほど濃く塗ります。枠だけのものは最初の選択肢(「なし」など)です
            </Row>
          </ul>
        </section>

        <section>
          <h3>操作</h3>
          <ul className="patient-chart__guide-text">
            <li>グラフの上でカーソルを動かすと、すべてのグラフで同じ時期の値が出ます。</li>
            <li>点・印・帯を押すと、元の記録を「開く」か、その日を「基準日に設定」できます。</li>
            <li>
              基準日に設定すると、その日が真ん中に来るように表示期間が変わり、ツールチップに「基準+14日」のような日数が出ます。ツールバーの「基準 ✕」で外せます。
            </li>
          </ul>
        </section>

        <p className="patient-chart__guide-note">
          同じ時期に値が動いていても、それだけで治療との因果関係は決まりません。検査の単位・測定法の変更や検査の間隔、併存疾患もあわせて確認してください。
        </p>
      </div>
    </Modal>
  );
}
