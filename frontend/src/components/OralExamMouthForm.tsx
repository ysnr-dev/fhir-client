import {
  MOUTH_SECTIONS,
  toothLabel,
  type MouthRecord,
  type OralExamCodeBook,
} from "../fhir/oralExamHelpers";
import { OralExamItemField } from "./OralExamItemField";

interface OralExamMouthFormProps {
  book: OralExamCodeBook | undefined;
  mouth: MouthRecord;
  onChange: (mouth: MouthRecord) => void;
  /** 歯式図で歯を選んでいる項目。 */
  pickingItem: string | null;
  onPick: (item: string | null) => void;
}

/** 口腔全体(口腔内装置等・矯正関係・その他の疾病及び異常・所見)。 */
export function OralExamMouthForm({ book, mouth, onChange, pickingItem, onPick }: OralExamMouthFormProps) {
  function setValue(item: string, code: string) {
    const values = { ...mouth.values };
    if (code) values[item] = code;
    else delete values[item];
    onChange({ ...mouth, values });
  }

  function setText(item: string, text: string) {
    onChange({ ...mouth, texts: { ...mouth.texts, [item]: text } });
  }

  function removeTooth(item: string, toothCode: string) {
    onChange({ ...mouth, teeth: { ...mouth.teeth, [item]: (mouth.teeth[item] ?? []).filter((c) => c !== toothCode) } });
  }

  return (
    <div className="oral-exam__mouth">
      {MOUTH_SECTIONS.map((section) => (
        <fieldset key={section.record} className="oral-exam__section">
          <legend>{section.label}</legend>
          <div className="oral-exam__fields">
            {section.items.map((def) =>
              def.teeth ? (
                <div key={def.item} className="oral-exam__field oral-exam__field--wide">
                  <span>{def.label}</span>
                  <div className="oral-exam__teeth-pick">
                    {(mouth.teeth[def.item] ?? []).map((toothCode) => (
                      <span key={toothCode} className="oral-exam__chip">
                        {toothLabel(toothCode)}
                        <button
                          type="button"
                          className="oral-exam__chip-remove"
                          aria-label={`${toothLabel(toothCode)}を外す`}
                          onClick={() => removeTooth(def.item, toothCode)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      className={
                        pickingItem === def.item ? "rp-card__compact-button is-active" : "rp-card__compact-button"
                      }
                      aria-pressed={pickingItem === def.item}
                      onClick={() => onPick(pickingItem === def.item ? null : def.item)}
                    >
                      {pickingItem === def.item ? "完了" : "歯式を選ぶ"}
                    </button>
                  </div>
                </div>
              ) : def.text ? (
                <label key={def.item} className="oral-exam__field oral-exam__field--wide">
                  {def.label}
                  <input
                    type="text"
                    value={mouth.texts[def.item] ?? ""}
                    onChange={(e) => setText(def.item, e.target.value)}
                  />
                </label>
              ) : (
                <OralExamItemField
                  key={def.item}
                  book={book}
                  item={def.item}
                  label={def.label}
                  value={mouth.values[def.item] ?? ""}
                  onChange={(code) => setValue(def.item, code)}
                />
              ),
            )}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
