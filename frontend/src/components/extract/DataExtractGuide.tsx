import type { ReactNode } from "react";
import { Modal } from "../Modal";

// データ抽出の使い方。画面の見出しの「?」から開く。中身は docs/data-extract-design.md の利用者向けの要約で、
// 流れ(番号つき)→ 条件の種類(表)→ 言葉の意味(用語と説明の 2 列)→ 例(条件の組み方)の順に、
// 拾い読みしやすい形で並べる。機能を足したらここも直す。

function Term({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** 例の条件の 1 行(種類のバッジ + 中身)。 */
function Leaf({ kind, not, children }: { kind: string; not?: boolean; children: ReactNode }) {
  return (
    <li className={not ? "extract-guide__leaf extract-guide__leaf--not" : "extract-guide__leaf"}>
      {not && <span className="extract-guide__badge extract-guide__badge--not">除外</span>}
      <span className="extract-guide__badge">{kind}</span>
      <span>{children}</span>
    </li>
  );
}

function Example({ title, op, children }: { title: string; op: "AND" | "OR"; children: ReactNode }) {
  return (
    <div className="extract-guide__example">
      <p className="extract-guide__example-title">{title}</p>
      <div className="extract-guide__example-body">
        <span className="extract-guide__op">{op}</span>
        <ul>{children}</ul>
      </div>
    </div>
  );
}

export function DataExtractGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="データ抽出の使い方" onClose={onClose} className="modal--wide">
      <div className="extract-guide">
        <p className="extract-guide__lead">
          条件に当てはまる患者を一覧にし、人数の内訳や CSV を出します。条件は保存して繰り返し使えます。
        </p>

        <section>
          <h3>使い方の流れ</h3>
          <ol className="extract-guide__steps">
            <li>
              <strong>条件を足す</strong>「＋条件」で種類を選び、項目と期間を入れます。
            </li>
            <li>
              <strong>組み合わせる</strong>AND / OR を切り替え、必要なら「＋グループ」で入れ子にします。
            </li>
            <li>
              <strong>実行する</strong>条件ごとに当てはまった人数が右に出ます。
            </li>
            <li>
              <strong>結果を見る</strong>一覧・内訳・推移を切り替え、CSV / 明細CSV で書き出します。
            </li>
            <li>
              <strong>保存する</strong>同じ条件をいつでも呼び出せます。
            </li>
          </ol>
        </section>

        <section>
          <h3>条件の種類</h3>
          <table className="extract-guide__table">
            <tbody>
              <tr>
                <th>患者属性</th>
                <td>性別、年齢(以上・以下)</td>
              </tr>
              <tr>
                <th>病名</th>
                <td>
                  病名マスタから選ぶか ICD10 を入力(E11 と入れると E110〜E119 もまとめて探す)。状態、開始日 / 登録日の期間
                </td>
              </tr>
              <tr>
                <th>検査結果・バイタル</th>
                <td>項目、値の範囲(8 以上 など)、期間</td>
              </tr>
              <tr>
                <th>処方・注射</th>
                <td>薬剤、または薬効分類(後から採用された薬も含む)。処方だけ / 注射だけ、期間</td>
              </tr>
              <tr>
                <th>部門オーダー</th>
                <td>
                  検体検査・放射線・内視鏡・手術などの種別、依頼 / 実施、期間、診療科。依頼は項目でも絞れる(検体検査・放射線・生理・内視鏡・処置・手術)
                </td>
              </tr>
              <tr>
                <th>入院</th>
                <td>期間中に入院していた / 入院した / 退院した、診療科、病棟</td>
              </tr>
              <tr>
                <th>外来受診</th>
                <td>期間中の受診</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3>条件の言葉</h3>
          <dl className="extract-guide__terms">
            <Term name="AND">すべての条件に当てはまる患者</Term>
            <Term name="OR">どれか 1 つに当てはまる患者</Term>
            <Term name="除外">AND の中で、その条件に当てはまる患者を外す</Term>
            <Term name="直近 N 日">今日から N 日前まで。保存すると、実行した日に合わせて期間がずれる</Term>
            <Term name="件数(以上)">期間内にその件数以上の記録がある患者だけ</Term>
            <Term name="基準の条件">別の条件の記録の日から「X 日〜Y 日」の記録だけを数える(マイナスは前)</Term>
          </dl>
        </section>

        <section>
          <h3>組み方の例</h3>
          <div className="extract-guide__examples">
            <Example title="90 日間 HbA1c を測っていない糖尿病の患者" op="AND">
              <Leaf kind="病名">2 型糖尿病(状態: 継続)</Leaf>
              <Leaf kind="検査" not>
                HbA1c(直近 90 日)
              </Leaf>
            </Example>
            <Example title="抗菌薬の注射が 30 日に 2 回以上" op="AND">
              <Leaf kind="処方・注射">薬効分類 61・62 / 区分: 注射 / 直近 30 日 / 件数 2 以上</Leaf>
            </Example>
            <Example title="退院後 30 日以内の再入院" op="AND">
              <Leaf kind="入院">退院した(直近 365 日)</Leaf>
              <Leaf kind="入院">入院した / 基準の条件: 上の退院・基準の日: 終了日・1〜30 日</Leaf>
            </Example>
            <Example title="内視鏡を依頼したが実施していない患者" op="AND">
              <Leaf kind="部門オーダー">内視鏡 / 依頼(直近 90 日)</Leaf>
              <Leaf kind="部門オーダー" not>
                内視鏡 / 実施(直近 90 日)
              </Leaf>
            </Example>
          </div>
        </section>

        <section>
          <h3>結果と出力</h3>
          <dl className="extract-guide__terms">
            <Term name="一覧">患者ごとの件数・最初と最後の日付・最新の値。氏名からカルテを開ける</Term>
            <Term name="内訳">性別 × 年齢階級の人数。条件を選んで月別・診療科別の件数も</Term>
            <Term name="推移">保存した条件を変えずに実行するたびに人数を記録し、グラフと表で並べる</Term>
            <Term name="出力項目">出す患者の列(カナ・住所 など)と条件ごとの列を選ぶ。実行し直さなくても反映</Term>
            <Term name="CSV">一覧と同じ列を患者 1 行で</Term>
            <Term name="明細CSV">当てはまった記録を 1 件 1 行で(検査の値・判定、薬の用量・日数 など)</Term>
            <Term name="保存 / 別名保存">今の条件を上書き / 院内共通・診療科・自分の条件として新しく保存(院内共通と診療科は医師のみ)</Term>
            <Term name="再読込">少し前に読んだ検索結果を捨てて読み直す(登録した直後のデータを含めたいとき)</Term>
          </dl>
        </section>

        <section>
          <h3>テンプレートの抽出</h3>
          <dl className="extract-guide__terms">
            <Term name="対象">「テンプレート」タブで選んだテンプレートの回答。版が違っても同じテンプレートならまとめて出す</Term>
            <Term name="表">回答 1 件が 1 行、項目が列。記入日時・記入者・診療科・版・状態の列つき</Term>
            <Term name="繰り返し">繰り返しのグループは「項目名_2」「項目名_3」… の列に分け、複数選択は「、」でつなぐ</Term>
            <Term name="患者">「患者」タブに保存した条件を選ぶと、その条件に該当する患者の回答だけを出す</Term>
            <Term name="患者フォルダ">選んだ患者フォルダ(下位フォルダを含む)の患者の回答だけを出す。「患者」と両方選ぶと両方に入る患者</Term>
            <Term name="患者ごとに最新">期間内で患者ごとにいちばん新しい回答だけを出す</Term>
            <Term name="CSV">表と同じ列ですべての行を出す(画面は先頭 500 行まで)</Term>
          </dl>
        </section>

        <section>
          <h3>検査結果の抽出</h3>
          <dl className="extract-guide__terms">
            <Term name="項目">「検査項目」で検査結果項目を、「バイタル」で体温・血圧などを選んで足す</Term>
            <Term name="行">測定日時ごと / 日ごと(同じ日に複数あれば遅い時刻の値)/ 患者ごと</Term>
            <Term name="集計">患者ごとの行で、項目ごとに最初・最新・最大・最小・平均・件数を列にする(最初・最新は日時の列つき)</Term>
            <Term name="H/L">値の隣に H / L の列を出す(バイタルは施設のしきい値で判定)</Term>
            <Term name="単位">単位がそろわない項目は単位の列を出す</Term>
            <Term name="患者 / 患者フォルダ">テンプレートの抽出と同じように、該当する患者の結果だけを出す</Term>
          </dl>
        </section>

        <section>
          <h3>投薬の抽出</h3>
          <dl className="extract-guide__terms">
            <Term name="表">処方・注射のオーダーの薬剤 1 件が 1 行。用量・用法・日数・処方区分・依頼科の列つき</Term>
            <Term name="薬剤 / 薬効分類">「患者」タブの処方・注射の条件と同じように選ぶ。選ばなければ期間内のすべての薬剤</Term>
            <Term name="区分">処方だけ・注射だけに絞る</Term>
            <Term name="期間">オーダー日で絞る</Term>
          </dl>
        </section>

        <section>
          <h3>細菌検査の抽出</h3>
          <dl className="extract-guide__terms">
            <Term name="表">分離菌 1 株が 1 行、抗菌薬が列。材料・培養・塗抹などの検体の列と、菌名・菌量・菌数・起炎性の列つき</Term>
            <Term name="感受性">抗菌薬の列に出す値(S/I/R・MIC)。両方選ぶと薬ごとに 2 列</Term>
            <Term name="分離菌なしの検体">培養陰性や塗抹のみの検体も 1 行出す</Term>
            <Term name="患者・菌ごとに初回">同じ患者の同じ菌は、いちばん古い 1 株だけを出す(感性率の集計向け)</Term>
            <Term name="患者 / 患者フォルダ">テンプレートの抽出と同じように、該当する患者の結果だけを出す</Term>
          </dl>
        </section>

        <section>
          <h3>手術の抽出</h3>
          <dl className="extract-guide__terms">
            <Term name="表">手術 1 件が 1 行。時刻と所要時間(在室・麻酔・手術)、術式、麻酔方法、スタッフ、出血量などの列つき</Term>
            <Term name="期間">入室日で絞る</Term>
            <Term name="術式">選んだ術式・麻酔の手技料のどれかを含む手術(主術式でも 2 件目以降でも)</Term>
            <Term name="依頼科">手術を申し込んだ診療科で絞る</Term>
            <Term name="患者 / 患者フォルダ">テンプレートの抽出と同じように、該当する患者の手術だけを出す</Term>
          </dl>
        </section>

        <section>
          <h3>部門実施の抽出</h3>
          <dl className="extract-guide__terms">
            <Term name="種別">放射線・生理・内視鏡・処置・輸血・リハビリ・栄養指導・服薬指導から 1 つ選ぶ</Term>
            <Term name="表">実施 1 件が 1 行。依頼項目・実施者・手技・薬剤・材料と、被曝線量などの測定値や実施単位数の列つき</Term>
            <Term name="期間">実施日で絞る</Term>
            <Term name="依頼科">オーダーを出した診療科で絞る</Term>
          </dl>
        </section>

        <section>
          <h3>有害事象の抽出</h3>
          <dl className="extract-guide__terms">
            <Term name="期間">発現日で絞る</Term>
            <Term name="用語">CTCAE の用語を選ぶと、その用語の記録だけを出す(複数選ぶとどれか)</Term>
            <Term name="治療">化学療法・放射線治療のどちらの有害事象かで絞る</Term>
            <Term name="行">1 件ごと / 患者・治療ごと(件数・最大 Grade と、用語ごとの最大 Grade の列)</Term>
          </dl>
        </section>

        <section>
          <h3>パスの抽出</h3>
          <dl className="extract-guide__terms">
            <Term name="表">パスの適用 1 件が 1 行。日数(予定・実際・差)、入院、終了区分、評価の件数とバリアンスの内容の列つき</Term>
            <Term name="期間">期間中に適用していたパスを出す</Term>
            <Term name="パス">選んだパスの適用だけを出す</Term>
          </dl>
        </section>

        <section>
          <h3>記録のタブの条件の保存</h3>
          <dl className="extract-guide__terms">
            <Term name="条件">テンプレート・検査結果などのタブでも、入力した条件を名前を付けて保存し、次から選んで呼び出す</Term>
            <Term name="保存 / 別名保存">今の条件を上書き / 院内共通・診療科・自分の条件として新しく保存</Term>
            <Term name="保存するもの">期間・患者・患者フォルダ・出力項目と、そのタブの入力欄(検査項目・薬剤・術式など)</Term>
          </dl>
        </section>

        <section>
          <h3>結果の患者をフォルダに入れる</h3>
          <dl className="extract-guide__terms">
            <Term name="フォルダ登録">どのタブでも、結果の患者を患者フォルダにまとめて入れる。既存のフォルダか、その場で作るフォルダを選ぶ</Term>
            <Term name="登録済み">すでにフォルダに入っている患者は飛ばす</Term>
            <Term name="その後">入れたフォルダは各タブの「患者フォルダ」の絞り込みに使える</Term>
          </dl>
        </section>

        <aside className="extract-guide__note">
          <h3>気をつけること</h3>
          <ul>
            <li>記録が多すぎて読み切れない条件があると、結果は出ません。期間を短くするか項目を絞ってください。</li>
            <li>外来受診は診療科で絞れません。</li>
            <li>入院の病棟は、転棟前にいた病棟でも当てはまります。</li>
            <li>部門オーダーの実施は、検体検査・細菌・病理・食事・放射線治療・他科依頼では選べません。</li>
            <li>細菌検査は診療科・材料・菌では絞れません。CSV に出してから絞ってください。</li>
          </ul>
        </aside>
      </div>
    </Modal>
  );
}
