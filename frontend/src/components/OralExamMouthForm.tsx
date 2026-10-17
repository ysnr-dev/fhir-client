import {
  MOUTH_SECTIONS,
  newMouthRecord,
  toothLabel,
  type MouthRecord,
  type OralExamCodeBook,
} from "../fhir/oralExamHelpers";
import { TrashIcon } from "./icons/TrashIcon";
import { OralExamItemField } from "./OralExamItemField";

/** 歯式図で歯を選んでいる口腔全体の項目(どの行のどの項目か)。 */
export interface MouthPick {
  key: string;
  item: string;
}

interface OralExamMouthFormProps {
  book: OralExamCodeBook | undefined;
  mouth: MouthRecord[];
  onChange: (mouth: MouthRecord[]) => void;
  picking: MouthPick | null;
  onPick: (pick: MouthPick | null) => void;
}

/**
 * 口腔全体(口腔内装置等・矯正関係・その他の疾病及び異常・所見)。区分ごとに行を足せる
 * (矯正装置が 2 つなら矯正関係を 2 行)。
 */
export function OralExamMouthForm({ book, mouth, onChange, picking, onPick }: OralExamMouthFormProps) {
  function replace(key: string, next: MouthRecord) {
    onChange(mouth.map((m) => (m.key === key ? next : m)));
  }

  return (
    <div className="oral-exam__mouth">
      {MOUTH_SECTIONS.map((section) => {
        const entries = mouth.filter((m) => m.record === section.record);
        return (
          <fieldset key={section.record} className="oral-exam__section">
            <legend>{section.label}</legend>
            {entries.map((entry, index) => (
              <div key={entry.key} className={entries.length > 1 ? "oral-exam__mouth-entry" : undefined}>
                {entries.length > 1 && (
                  <div className="oral-exam__content-head">
                    <span>{index + 1}</span>
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      title={`${section.label}を削除`}
                      aria-label={`${section.label}を削除`}
                      onClick={() => onChange(mouth.filter((m) => m.key !== entry.key))}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                )}
                <MouthEntryFields
                  book={book}
                  section={section}
                  entry={entry}
                  onChange={(next) => replace(entry.key, next)}
                  picking={picking}
                  onPick={onPick}
                />
              </div>
            ))}
            <div className="oral-exam__subhead">
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() => onChange([...mouth, newMouthRecord(section.record)])}
              >
                追加
              </button>
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function MouthEntryFields({
  book,
  section,
  entry,
  onChange,
  picking,
  onPick,
}: {
  book: OralExamCodeBook | undefined;
  section: (typeof MOUTH_SECTIONS)[number];
  entry: MouthRecord;
  onChange: (entry: MouthRecord) => void;
  picking: MouthPick | null;
  onPick: (pick: MouthPick | null) => void;
}) {
  function setValue(item: string, code: string) {
    const values = { ...entry.values };
    if (code) values[item] = code;
    else delete values[item];
    onChange({ ...entry, values });
  }

  function removeTooth(item: string, toothCode: string) {
    onChange({ ...entry, teeth: { ...entry.teeth, [item]: (entry.teeth[item] ?? []).filter((c) => c !== toothCode) } });
  }

  return (
    <div className="oral-exam__fields">
      {section.items.map((def) => {
        if (def.teeth) {
          const active = picking?.key === entry.key && picking.item === def.item;
          return (
            <div key={def.item} className="oral-exam__field oral-exam__field--wide">
              <span>{def.label}</span>
              <div className="oral-exam__teeth-pick">
                {(entry.teeth[def.item] ?? []).map((toothCode) => (
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
                  className={active ? "rp-card__compact-button is-active" : "rp-card__compact-button"}
                  aria-pressed={active}
                  onClick={() => onPick(active ? null : { key: entry.key, item: def.item })}
                >
                  {active ? "完了" : "歯式を選ぶ"}
                </button>
              </div>
            </div>
          );
        }
        if (def.text) {
          return (
            <label key={def.item} className="oral-exam__field oral-exam__field--wide">
              {def.label}
              <input
                type="text"
                value={entry.texts[def.item] ?? ""}
                onChange={(e) => onChange({ ...entry, texts: { ...entry.texts, [def.item]: e.target.value } })}
              />
            </label>
          );
        }
        return (
          <OralExamItemField
            key={def.item}
            book={book}
            item={def.item}
            label={def.label}
            value={entry.values[def.item] ?? ""}
            onChange={(code) => setValue(def.item, code)}
          />
        );
      })}
    </div>
  );
}
