import {
  ORAL_EXAM_STAMPS,
  STAMP_GROUP_LABELS,
  type OralExamStamp,
  type StampGroup,
} from "../fhir/oralExamHelpers";

interface OralExamStampPaletteProps {
  /** 選んでいるスタンプ。null は「選択」(歯を押すと編集パネルを開く)。 */
  stamp: OralExamStamp | null;
  onChange: (stamp: OralExamStamp | null) => void;
  /** 複数の歯で 1 つの装置になるもの(ブリッジ・連結冠・有床義歯)は専用のモーダルで入れる。 */
  onOpenBridge: () => void;
  onOpenDenture: () => void;
}

const GROUPS: StampGroup[] = ["state", "caries", "restoration", "prosthesis"];

/**
 * 歯式図に押すスタンプのパレット。スタンプを選んで歯(う蝕・充填は歯面)を押すと、その状態になる。
 * ブリッジ・連結冠・有床義歯は装置ごとのモーダルを開くボタンを置く。
 */
export function OralExamStampPalette({
  stamp,
  onChange,
  onOpenBridge,
  onOpenDenture,
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
            <>
              <button type="button" className="oral-exam__stamp oral-exam__stamp--device" onClick={onOpenBridge}>
                ブリッジ・連結冠
              </button>
              <button type="button" className="oral-exam__stamp oral-exam__stamp--device" onClick={onOpenDenture}>
                有床義歯
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
