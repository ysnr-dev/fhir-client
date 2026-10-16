import { Modal } from "./Modal";

// 早期警告スコア(NEWS2 / qSOFA)の計算式。バイタル入力の NEWS2 の「?」から開く。
// 点数の境界は fhir/earlyWarningHelpers.ts の computeNews2 / computeQsofa と同じ値にする。
// 見た目は他の使い方のモーダル(ChartScatterGuide など)と同じクラスを使う。

/** NEWS2 の点数表。列は 3・2・1・0・1・2・3 点(低い側 → 高い側)。該当の無い枠は空。 */
const NEWS2_ROWS: { label: string; cells: [string, string, string, string, string, string, string] }[] = [
  { label: "呼吸数(/分)", cells: ["≤8", "", "9–11", "12–20", "", "21–24", "≥25"] },
  { label: "SpO2(%) スケール1", cells: ["≤91", "92–93", "94–95", "≥96", "", "", ""] },
  {
    label: "SpO2(%) スケール2",
    cells: ["≤83", "84–85", "86–87", "88–92\n室内気で ≥93", "酸素下 93–94", "酸素下 95–96", "酸素下 ≥97"],
  },
  { label: "酸素投与", cells: ["", "あり", "", "室内気", "", "", ""] },
  { label: "収縮期血圧(mmHg)", cells: ["≤90", "91–100", "101–110", "111–219", "", "", "≥220"] },
  { label: "脈拍(/分)", cells: ["≤40", "", "41–50", "51–90", "91–110", "111–130", "≥131"] },
  { label: "意識(JCS)", cells: ["", "", "", "0", "", "", "1 以上"] },
  { label: "体温(℃)", cells: ["≤35.0", "", "35.1–36.0", "36.1–38.0", "38.1–39.0", "≥39.1", ""] },
];

const POINT_HEADERS = ["3", "2", "1", "0", "1", "2", "3"];

const BAND_ROWS: { band: string; rule: string; className: string }[] = [
  { band: "高", rule: "合計 7 点以上", className: "ews-formula__band--high" },
  { band: "中", rule: "合計 5〜6 点", className: "ews-formula__band--medium" },
  { band: "低〜中", rule: "合計 4 点以下で、いずれかの項目が 3 点", className: "ews-formula__band--low-medium" },
  { band: "低", rule: "合計 0〜4 点で、3 点の項目が無い", className: "" },
];

export function EarlyWarningFormulaModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="早期警告スコアの計算式" onClose={onClose} className="modal--wide">
      <div className="patient-chart__guide">
        <section>
          <h3>NEWS2(7 項目の合計 0〜20 点)</h3>
          <div className="ews-formula__table-wrap">
            <table className="ews-formula__table">
              <thead>
                <tr>
                  <th>点数</th>
                  {POINT_HEADERS.map((points, index) => (
                    <th key={index} className={`ews-formula__points ews-formula__points--${points}`}>
                      {points}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NEWS2_ROWS.map((row) => (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    {row.cells.map((cell, index) => (
                      <td key={index}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="patient-chart__guide-text">
            <li>
              意識は JCS を ACVPU に写して判定します。0 = A(0 点)、I 桁 = C(新たな見当識障害)、II 桁 = V、III-100・200 = P、III-300 = U で、A 以外は 3 点です。
            </li>
            <li>SpO2 スケール2 は、注意区分「SpO2 スケール2(高CO2血症リスク)」が付いた患者にだけ使います。</li>
            <li>測っていない項目は 0 点にせず、合計に「暫定」を添えます。</li>
          </ul>
        </section>

        <section>
          <h3>区分</h3>
          <table className="ews-formula__table ews-formula__table--bands">
            <tbody>
              {BAND_ROWS.map((row) => (
                <tr key={row.band}>
                  <th className={row.className}>{row.band}</th>
                  <td>{row.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>入院中の患者で、施設設定の通知する区分以上になると主治医に通知します。</p>
        </section>

        <section>
          <h3>qSOFA(3 項目、各 1 点)</h3>
          <ul className="patient-chart__guide-text">
            <li>呼吸数 22/分 以上</li>
            <li>収縮期血圧 100 mmHg 以下</li>
            <li>意識変容(JCS 1 以上)</li>
          </ul>
          <p>2 点以上で敗血症を疑います。</p>
        </section>
      </div>
    </Modal>
  );
}
