import { useState } from "react";
import { TOOTH_ROWS, type ToothCategory } from "../fhir/oralExamHelpers";
import { Modal } from "./Modal";
import { OralExamToothGlyph } from "./OralExamToothGlyph";

// 歯式図の凡例。歯式図の横の「?」から開く。見た目はマルチチャートの見方(PatientChartGuide)と同じクラスを使う。

const SAMPLE_TOOTH = TOOTH_ROWS[0].teeth[2]; // 右上6

const CATEGORY_SAMPLES: { category: ToothCategory | "none"; label: string }[] = [
  { category: "sound", label: "健全歯・現在歯" },
  { category: "observe", label: "要観察歯(CO)・要注意乳歯" },
  { category: "caries", label: "未処置歯(う蝕・残根)" },
  { category: "treated", label: "処置歯" },
  { category: "prosthetic", label: "欠損補綴歯(ブリッジのポンティック・義歯)・インプラント" },
  { category: "missing", label: "喪失歯・欠損歯(斜線)" },
  { category: "impacted", label: "埋伏歯・未萌出歯(点線)" },
  { category: "unknown", label: "未検査・情報なし(縞)" },
  { category: "none", label: "記録なし(点線の枠)" },
];

const SYMBOLS: [string, string][] = [
  ["／", "現在歯・健全歯"],
  ["C", "未処置歯(治療中を含む)"],
  ["○", "処置歯"],
  ["△", "喪失歯・欠損歯"],
  ["(△)", "欠損補綴歯(インプラントを含む)"],
  ["シ", "シーラント"],
  ["サ", "サホライド"],
  ["CO", "要観察歯"],
  ["×", "要注意乳歯"],
];

const ABBREVIATIONS: [string, string][] = [
  ["C1〜C4", "う蝕の程度(C4 は残根)"],
  ["Att・Abr・WSD・FrT・Ero", "咬耗・磨耗・くさび状欠損・破折・酸蝕症"],
  ["CR・AF・In・On", "コンポジットレジン充填・アマルガム充填・インレー・アンレー"],
  ["3/4・4/5・LV", "3/4 冠・4/5 冠・ラミネートベニア"],
  ["FMC・前装・MB", "全部金属冠・前装金属冠・メタルボンドクラウン"],
  ["HJC・セラ・JC", "全部非金属冠(レジン系・セラミック系・材質不明)"],
  ["CAD・CAD-In", "CAD/CAM 冠・CAD/CAM インレー(材料が CAD/CAM冠用材料)"],
  ["TeC", "仮歯(テンポラリークラウン)"],
  ["Br・連結", "ブリッジの支台・連結冠"],
  ["Pon・隙", "ポンティック・補綴隙"],
  ["PD・FD・Den", "局部義歯・総義歯・そのほかの有床義歯(PD2 などは 2 床目・3 床目)"],
  ["Bar・Pl・LA・補強", "大連結子(バー・プレート・リンガルエプロン)・補強線"],
  ["Im・Abu", "インプラント・アバットメント"],
  ["HRT・RT・HIT", "半埋伏歯・埋伏歯・水平埋伏智歯"],
];

function Sample({ category, surfaces = [], crossed = false }: {
  category: ToothCategory | "none";
  surfaces?: string[];
  crossed?: boolean;
}) {
  return (
    <span className={`oral-exam__legend-tooth oral-exam__tooth--${category}`}>
      <OralExamToothGlyph tooth={SAMPLE_TOOTH} surfaces={new Set(surfaces)} crossed={crossed} />
    </span>
  );
}

export function OralExamLegend({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="歯式図の見方" onClose={onClose} className="modal--wide">
      <div className="patient-chart__guide oral-exam__legend">
        <section>
          <h3>歯の並び</h3>
          <p>
            上から上顎永久歯・上顎乳歯・下顎乳歯・下顎永久歯の順で、患者の右が画面の左です。番号は永久歯が 1〜8、乳歯が A〜E
            (正中から数える)。乳歯の行は 15 歳未満か乳歯に記録があるときに出ます。
          </p>
        </section>

        <section>
          <h3>歯の色(基本状態)</h3>
          <ul>
            {CATEGORY_SAMPLES.map((s) => (
              <li key={s.category}>
                <Sample category={s.category} crossed={s.category === "missing"} />
                <span>{s.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>歯面(5 面図)</h3>
          <ul>
            <li>
              <Sample category="caries" surfaces={["TP-13", "TP-16"]} />
              <span>
                中央が切端・咬合面(IO)、周りの 4 面が頬側(唇側)B・口蓋側(舌側)PL・近心 M・遠心 D です。頬側は口の外側
                (上顎は上、下顎は下)、近心は正中の側です。う蝕や充填を付けた面が塗られます(この例は咬合面と近心)。
              </span>
            </li>
          </ul>
        </section>

        <section>
          <h3>歯の下(下顎は上)の記号</h3>
          <ul className="oral-exam__legend-grid">
            {SYMBOLS.map(([symbol, label]) => (
              <li key={symbol}>
                <b className="oral-exam__legend-code">{symbol}</b>
                <span>{label}</span>
              </li>
            ))}
          </ul>
          <p>歯科健診記号です。基本状態から決まります。</p>
        </section>

        <section>
          <h3>略号</h3>
          <ul>
            {ABBREVIATIONS.map(([abbr, label]) => (
              <li key={abbr}>
                <b className="oral-exam__legend-code oral-exam__legend-code--wide">{abbr}</b>
                <span>{label}</span>
              </li>
            ))}
          </ul>
          <p>
            内容が多い歯は優先順に 2 つまで出します(う蝕 → 冠 → その他の修復 → 部分修復 → 仮歯 → 支台 → 欠損補綴)。
            全部は歯にカーソルを合わせると出ます。
          </p>
        </section>

        <section>
          <h3>そのほかの印</h3>
          <ul>
            <li>
              <b className="oral-exam__legend-code oral-exam__clasp">Cl・R</b>
              <span>クラスプ・レストのある鉤歯(Cl2 などは 2 床目・3 床目の義歯の鉤)。</span>
            </li>
            <li>
              <span className="oral-exam__legend-line oral-exam__legend-line--bridge" />
              <span>同じブリッジ・連結冠の歯(実線でつながる)。</span>
            </li>
            <li>
              <span className="oral-exam__legend-line oral-exam__legend-line--denture" />
              <span>同じ有床義歯の人工歯と鉤歯(破線)。</span>
            </li>
            <li>
              <b className="oral-exam__legend-code oral-exam__badge oral-exam__legend-badge">2</b>
              <span>
                右肩の数字は、併存グループ(残根上義歯など)が複数あればその数、無ければ現在歯の内容(1 歯 2 窩洞など)の数です。
              </span>
            </li>
            <li>
              <b className="oral-exam__legend-code">+</b>
              <span>歯の下の小さな「+」は近傍過剰歯です。</span>
            </li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}

/** 歯式図の横に置く「?」。押すと凡例を開く。 */
export function OralExamLegendButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="modal__help"
        onClick={() => setOpen(true)}
        aria-label="歯式図の見方"
        title="歯式図の見方"
      >
        ?
      </button>
      {open && <OralExamLegend onClose={() => setOpen(false)} />}
    </>
  );
}
