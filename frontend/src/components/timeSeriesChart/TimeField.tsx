import { nowInput } from "../../fhir/timeSeriesChartHelpers";

/**
 * 時刻の入力欄。記録は「今」を打つことがほとんどなので、開いている間に古く
 * なった既定値を押し直せるボタンを添える。
 */
export function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <span className="time-chart__time-field">
        <input type="datetime-local" required value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="time-chart__now" title="現在時刻を入れる" onClick={() => onChange(nowInput())}>
          現在
        </button>
      </span>
    </label>
  );
}
