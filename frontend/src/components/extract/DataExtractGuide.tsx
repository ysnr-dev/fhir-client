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

        <aside className="extract-guide__note">
          <h3>気をつけること</h3>
          <ul>
            <li>記録が多すぎて読み切れない条件があると、結果は出ません。期間を短くするか項目を絞ってください。</li>
            <li>外来受診は診療科で絞れません。</li>
            <li>入院の病棟は、転棟前にいた病棟でも当てはまります。</li>
          </ul>
        </aside>
      </div>
    </Modal>
  );
}
