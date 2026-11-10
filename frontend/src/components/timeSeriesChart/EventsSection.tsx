import { useState, type FormEvent } from "react";
import { nowInput, type ChartEventLine, type ChartSpec } from "../../fhir/timeSeriesChartHelpers";
import { RemoveRowButton } from "../RemoveRowButton";
import { TimeField } from "./TimeField";

// イベントの一覧と追加フォーム。「その他」だけ自由文を本体にする。

interface EventsSectionProps {
  spec: ChartSpec;
  events: readonly ChartEventLine[];
  readOnly: boolean;
  onAdd: (code: string, occurredAt: string, note: string) => void;
  onDelete: (event: ChartEventLine) => void;
}

export function EventsSection({ spec, events, readOnly, onAdd, onDelete }: EventsSectionProps) {
  const [code, setCode] = useState<string>(spec.events[0]?.code ?? "");
  const [occurredAt, setOccurredAt] = useState(nowInput);
  const [note, setNote] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onAdd(code, occurredAt, note);
    setNote("");
    setOccurredAt(nowInput());
  }

  return (
    <fieldset className="time-chart__section">
      <legend>イベント</legend>
      {events.length === 0 ? (
        <p className="patient-table__empty">イベントはまだありません。</p>
      ) : (
        <ul className="time-chart__list">
          {events.map((event) => (
            <li key={event.id}>
              <span className="time-chart__list-time">{event.time.slice(11, 16)}</span>
              <span>{event.label}</span>
              {event.note && <span className="time-chart__list-note">{event.note}</span>}
              {!readOnly && <RemoveRowButton title="削除" onClick={() => onDelete(event)} />}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <form className="time-chart__entry" onSubmit={submit}>
          <TimeField label="時刻" value={occurredAt} onChange={setOccurredAt} />
          <label>
            種別
            <select value={code} onChange={(e) => setCode(e.target.value)}>
              {spec.events.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            メモ
            <input
              type="text"
              value={note}
              required={code === "other"}
              placeholder={code === "other" ? "内容(必須)" : "任意"}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button type="submit">追加</button>
        </form>
      )}
    </fieldset>
  );
}
