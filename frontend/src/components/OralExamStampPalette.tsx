import {
  DENTURE_NUMBERS,
  ORAL_EXAM_STAMPS,
  STAMP_GROUP_LABELS,
  type OralExamStamp,
  type StampGroup,
} from "../fhir/oralExamHelpers";

interface OralExamStampPaletteProps {
  /** 選んでいるスタンプ。null は「選択」(歯を押すと編集パネルを開く)。 */
  stamp: OralExamStamp | null;
  onChange: (stamp: OralExamStamp | null) => void;
  /** 義歯・クラスプ・レストに付ける床番号(DENTURE_NUMBERS の code)。 */
  dentureNumber: string;
  onDentureNumberChange: (code: string) => void;
}

const GROUPS: StampGroup[] = ["state", "caries", "restoration", "prosthesis"];

/** 歯式図に押すスタンプのパレット。スタンプを選んで歯(う蝕・充填は歯面)を押すと、その状態になる。 */
export function OralExamStampPalette({
  stamp,
  onChange,
  dentureNumber,
  onDentureNumberChange,
}: OralExamStampPaletteProps) {
  return (
    <div className="oral-exam__palette" role="toolbar" aria-label="スタンプ">
      <div className="oral-exam__palette-group">
        <button
          type="button"
          className={stamp ? "oral-exam__stamp" : "oral-exam__stamp is-active"}
          aria-pressed={!stamp}
          onClick={() => onChange(null)}
        >
          選択
        </button>
      </div>
      {GROUPS.map((group) => (
        <div key={group} className="oral-exam__palette-group">
          <span className="oral-exam__palette-label">{STAMP_GROUP_LABELS[group]}</span>
          {ORAL_EXAM_STAMPS.filter((s) => s.group === group).map((s) => (
            <button
              key={s.key}
              type="button"
              className={`oral-exam__stamp oral-exam__stamp--${s.key}${stamp?.key === s.key ? " is-active" : ""}`}
              title={s.title}
              aria-pressed={stamp?.key === s.key}
              onClick={() => onChange(stamp?.key === s.key ? null : s)}
            >
              {s.label}
            </button>
          ))}
          {group === "prosthesis" && (
            <select
              className="oral-exam__denture-number"
              aria-label="義歯の床番号"
              value={dentureNumber}
              onChange={(e) => onDentureNumberChange(e.target.value)}
            >
              {DENTURE_NUMBERS.map((n) => (
                <option key={n.code} value={n.code}>
                  {n.label}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}
