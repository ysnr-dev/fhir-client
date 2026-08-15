import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  VITAL_MEASURES,
  vitalBmi,
  type VitalFormValues,
} from "../fhir/vitalHelpers";
import { ProblemSelect } from "./ProblemSelect";

// バイタルの入力欄。血圧だけは収縮期/拡張期を 1 行に並べる(1 回の測定として
// まとめて Observation にするため、片方だけの入力は登録時に弾く)。

interface VitalFormProps {
  values: VitalFormValues;
  onChange: (values: VitalFormValues) => void;
  problem: ProblemRef | null;
  problemOptions: ProblemRef[];
  onProblemChange: (problem: ProblemRef | null) => void;
  onSubmit: () => void;
  submitLabel: string;
  submitting: boolean;
}

export function VitalForm({
  values,
  onChange,
  problem,
  problemOptions,
  onProblemChange,
  onSubmit,
  submitLabel,
  submitting,
}: VitalFormProps) {
  function update<K extends keyof VitalFormValues>(key: K, value: VitalFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  const bmi = vitalBmi(values);

  return (
    <form
      className="vital-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="qp-field">
        <label>
          <span className="qp-field__label">測定日時</span>
          <input
            type="datetime-local"
            value={values.measuredAt}
            onChange={(e) => update("measuredAt", e.target.value)}
          />
        </label>
      </div>
      <div className="qp-field">
        <label>
          <span className="qp-field__label">対象プロブレム</span>
          <ProblemSelect value={problem} options={problemOptions} onChange={onProblemChange} />
        </label>
      </div>

      <div className="vital-form__grid">
        {/* 血圧は 1 つの測定なので 1 行にまとめる。 */}
        <div className="vital-form__row">
          <span className="vital-form__label">血圧</span>
          <input
            type="number"
            step="1"
            value={values.systolic}
            aria-label="収縮期血圧"
            onChange={(e) => update("systolic", e.target.value)}
          />
          <span className="vital-form__separator">/</span>
          <input
            type="number"
            step="1"
            value={values.diastolic}
            aria-label="拡張期血圧"
            onChange={(e) => update("diastolic", e.target.value)}
          />
          <span className="vital-form__unit">mmHg</span>
        </div>

        {VITAL_MEASURES.map((measure) => (
          <div className="vital-form__row" key={measure.key}>
            <span className="vital-form__label">{measure.label}</span>
            <input
              type="number"
              step={measure.step}
              value={values[measure.key]}
              aria-label={measure.label}
              onChange={(e) => update(measure.key, e.target.value)}
            />
            <span className="vital-form__unit">{measure.unit}</span>
          </div>
        ))}

        {/* BMI は身長・体重から一意に決まるので入力欄は持たない。 */}
        <div className="vital-form__row vital-form__row--derived">
          <span className="vital-form__label">BMI</span>
          <span className="vital-form__derived-value">{bmi === null ? "—" : bmi}</span>
          <span className="vital-form__unit">kg/m²</span>
        </div>
      </div>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
