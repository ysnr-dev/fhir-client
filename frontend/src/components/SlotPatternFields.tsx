import {
  APPOINTMENT_TYPE_OPTIONS,
  WEEKDAY_LABELS,
  type SlotPattern,
  type SlotTimeBlock,
} from "../fhir/scheduleHelpers";

// 枠の曜日パターン(曜日 × 時間帯 × 1 枠の長さ)の入力欄。枠表の登録画面と、
// カレンダーの一括生成モーダルの双方から使う。

interface SlotPatternFieldsProps {
  value: SlotPattern;
  onChange: (pattern: SlotPattern) => void;
}

export function SlotPatternFields({ value, onChange }: SlotPatternFieldsProps) {
  function toggleWeekday(weekday: number) {
    const weekdays = value.weekdays.includes(weekday)
      ? value.weekdays.filter((w) => w !== weekday)
      : [...value.weekdays, weekday].sort();
    onChange({ ...value, weekdays });
  }

  function updateBlock(index: number, block: Partial<SlotTimeBlock>) {
    const blocks = value.blocks.map((b, i) => (i === index ? { ...b, ...block } : b));
    onChange({ ...value, blocks });
  }

  function addBlock() {
    onChange({ ...value, blocks: [...value.blocks, { start: "09:00", end: "12:00" }] });
  }

  function removeBlock(index: number) {
    onChange({ ...value, blocks: value.blocks.filter((_, i) => i !== index) });
  }

  return (
    <div className="slot-pattern">
      <div className="slot-pattern__weekdays">
        <span className="slot-pattern__label">曜日</span>
        <div className="slot-pattern__weekday-list">
          {WEEKDAY_LABELS.map((label, weekday) => (
            <label key={weekday} className="slot-pattern__weekday">
              <input
                type="checkbox"
                checked={value.weekdays.includes(weekday)}
                onChange={() => toggleWeekday(weekday)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="slot-pattern__blocks">
        <span className="slot-pattern__label">時間帯</span>
        <div className="slot-pattern__block-list">
          {value.blocks.map((block, index) => (
            <div key={index} className="slot-pattern__block">
              <input
                type="time"
                value={block.start}
                onChange={(e) => updateBlock(index, { start: e.target.value })}
              />
              <span>〜</span>
              <input
                type="time"
                value={block.end}
                onChange={(e) => updateBlock(index, { end: e.target.value })}
              />
              <button
                type="button"
                className="slot-pattern__block-remove"
                onClick={() => removeBlock(index)}
                disabled={value.blocks.length <= 1}
                aria-label="この時間帯を削除"
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" onClick={addBlock}>
            時間帯を追加
          </button>
        </div>
      </div>

      <div className="slot-pattern__row">
        <label>
          1 枠の長さ(分)
          <input
            type="number"
            min={1}
            step={1}
            value={value.durationMinutes}
            onChange={(e) => onChange({ ...value, durationMinutes: Number(e.target.value) })}
          />
        </label>
        <label>
          予約種別
          <select
            value={value.appointmentTypeCode}
            onChange={(e) => onChange({ ...value, appointmentTypeCode: e.target.value })}
          >
            {APPOINTMENT_TYPE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
