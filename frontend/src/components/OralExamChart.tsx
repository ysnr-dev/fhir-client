import {
  checkupSymbol,
  filledSurfaces,
  isSupernumerary,
  recordsOfTooth,
  supernumeraryCode,
  TOOTH_ROWS,
  toothCategory,
  toothLabel,
  type ToothRecord,
} from "../fhir/oralExamHelpers";
import { OralExamToothGlyph } from "./OralExamToothGlyph";

interface OralExamChartProps {
  teeth: ToothRecord[];
  /** 選んでいる歯(歯種コード)。 */
  selected: string[];
  onSelect: (toothCode: string) => void;
  /** 歯面を押したとき(スタンプを面に付ける)。無ければ歯面は押せない。 */
  onSelectFace?: (toothCode: string, face: string) => void;
  showDeciduous: boolean;
}

/**
 * 歯式図。上から上顎永久歯・上顎乳歯・下顎乳歯・下顎永久歯の 4 行で、患者の右が画面の左。
 * 歯の色は基本状態、塗った面は現在歯の内容の歯面、下の字は歯科健診記号。
 * 併存グループ・併存レコードが複数ある歯は右肩に数を出し、近傍過剰歯は歯の下に小さく並べる。
 */
export function OralExamChart({ teeth, selected, onSelect, onSelectFace, showDeciduous }: OralExamChartProps) {
  const rows = TOOTH_ROWS.filter((row) => showDeciduous || !row.deciduous);
  const supernumeraries = new Set(teeth.filter((t) => isSupernumerary(t.toothCode)).map((t) => t.toothCode));

  return (
    <div className="oral-exam__chart" role="group" aria-label="歯式">
      {rows.map((row) => (
        <div
          key={row.key}
          className={`oral-exam__row oral-exam__row--${row.key}`}
        >
          {row.teeth.map((def, index) => {
            const records = recordsOfTooth(teeth, def.code);
            const primary = records[0];
            const category = primary ? toothCategory(primary.basic) : "none";
            const contents = records.reduce((n, r) => n + r.contents.length, 0);
            const badge = records.length > 1 ? String(records.length) : contents > 1 ? String(contents) : "";
            const extra = supernumeraryCode(def.code);
            const midline = index === row.teeth.length / 2;
            return (
              <div key={def.code} className={midline ? "oral-exam__cell is-midline" : "oral-exam__cell"}>
                <button
                  type="button"
                  className={`oral-exam__tooth oral-exam__tooth--${category}${
                    selected.includes(def.code) ? " is-selected" : ""
                  }`}
                  onClick={() => onSelect(def.code)}
                  title={toothLabel(def.code)}
                  aria-label={toothLabel(def.code)}
                  aria-pressed={selected.includes(def.code)}
                >
                  {row.key.startsWith("lower") && <span className="oral-exam__symbol">{primary ? checkupSymbol(primary.basic) : ""}</span>}
                  {row.key.startsWith("upper") && <span className="oral-exam__number">{def.label}</span>}
                  <OralExamToothGlyph
                    tooth={def}
                    surfaces={filledSurfaces(records)}
                    crossed={category === "missing"}
                    onFace={onSelectFace ? (face) => onSelectFace(def.code, face) : undefined}
                  />
                  {row.key.startsWith("upper") && <span className="oral-exam__symbol">{primary ? checkupSymbol(primary.basic) : ""}</span>}
                  {row.key.startsWith("lower") && <span className="oral-exam__number">{def.label}</span>}
                  {badge && <span className="oral-exam__badge">{badge}</span>}
                </button>
                {supernumeraries.has(extra) && (
                  <button
                    type="button"
                    className={`oral-exam__extra oral-exam__tooth--${toothCategory(recordsOfTooth(teeth, extra)[0]?.basic ?? "")}${
                      selected.includes(extra) ? " is-selected" : ""
                    }`}
                    onClick={() => onSelect(extra)}
                    title={toothLabel(extra)}
                    aria-label={toothLabel(extra)}
                    aria-pressed={selected.includes(extra)}
                  >
                    +
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
