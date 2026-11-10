import { useState, type FormEvent } from "react";
import { nowInput, type ChartPoint, type ChartPointFormValues, type ChartSpec } from "../../fhir/timeSeriesChartHelpers";
import { TimeField } from "./TimeField";

// 打点の表(列 = 時点、行 = 項目)と追加フォーム。入力した項目だけが Observation になる。

interface PointsSectionProps {
  spec: ChartSpec;
  points: readonly ChartPoint[];
  readOnly: boolean;
  /** 区画の見出し。 */
  legend: string;
  onAdd: (values: ChartPointFormValues) => void;
  onDeletePoint: (point: ChartPoint) => void;
}

export function PointsSection({ spec, points, readOnly, legend, onAdd, onDeletePoint }: PointsSectionProps) {
  const [measuredAt, setMeasuredAt] = useState(nowInput);
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [values, setValues] = useState<Partial<Record<string, string>>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    onAdd({ measuredAt, systolic, diastolic, values });
    setSystolic("");
    setDiastolic("");
    setValues({});
    setMeasuredAt(nowInput());
  }

  return (
    <fieldset className="time-chart__section">
      <legend>{legend}</legend>
      {points.length === 0 ? (
        <p className="patient-table__empty">打点はまだありません。</p>
      ) : (
        <div className="time-chart__table-scroll">
          <table className="time-chart__table">
            <thead>
              <tr>
                <th></th>
                {points.map((point) => (
                  <th key={point.time}>
                    {point.time.slice(11, 16)}
                    {!readOnly && (
                      <button
                        type="button"
                        className="time-chart__cell-delete"
                        title="この時点の打点を削除"
                        onClick={() => onDeletePoint(point)}
                      >
                        ×
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>血圧</th>
                {points.map((point) => (
                  <td key={point.time}>
                    {point.systolic != null && point.diastolic != null ? `${point.systolic}/${point.diastolic}` : ""}
                  </td>
                ))}
              </tr>
              {spec.measures.map((measure) => (
                <tr key={measure.key}>
                  <th>{measure.label}</th>
                  {points.map((point) => (
                    <td key={point.time}>{point.values[measure.key] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && (
        <form className="time-chart__entry" onSubmit={submit}>
          <TimeField label="時刻" value={measuredAt} onChange={setMeasuredAt} />
          <label>
            血圧
            <span className="time-chart__bp-pair">
              <input type="number" step="1" placeholder="収縮" value={systolic} onChange={(e) => setSystolic(e.target.value)} />
              /
              <input type="number" step="1" placeholder="拡張" value={diastolic} onChange={(e) => setDiastolic(e.target.value)} />
            </span>
          </label>
          {spec.measures.map((measure) => (
            <label key={measure.key}>
              {measure.label}
              <input
                type="number"
                step={measure.step}
                value={values[measure.key] ?? ""}
                onChange={(e) => setValues((current) => ({ ...current, [measure.key]: e.target.value }))}
              />
            </label>
          ))}
          <button type="submit">追加</button>
        </form>
      )}
    </fieldset>
  );
}
