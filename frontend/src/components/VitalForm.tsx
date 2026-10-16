import { useState } from "react";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  computeNews2,
  computeQsofa,
  EARLY_WARNING_BAND_LABEL,
  earlyWarningInputOf,
  hasEarlyWarningInput,
  news2MissingText,
  type EarlyWarningSettings,
} from "../fhir/earlyWarningHelpers";
import {
  JCS_MEASURE,
  JCS_OPTIONS,
  VITAL_MEASURES,
  vitalBmi,
  type VitalFormValues,
} from "../fhir/vitalHelpers";
import { EarlyWarningFormulaModal } from "./EarlyWarningFormulaModal";
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
  /** 早期警告スコアの表示。施設設定で無効なら渡さない。 */
  earlyWarning?: { settings: EarlyWarningSettings; spo2Scale2: boolean };
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
  earlyWarning,
}: VitalFormProps) {
  function update<K extends keyof VitalFormValues>(key: K, value: VitalFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  const [formulaOpen, setFormulaOpen] = useState(false);
  const bmi = vitalBmi(values);
  const scoreInput = earlyWarning?.settings.enabled ? earlyWarningInputOf(values, earlyWarning.spo2Scale2) : null;
  const news2 = scoreInput ? computeNews2(scoreInput) : null;
  const qsofa = scoreInput && earlyWarning?.settings.show_qsofa ? computeQsofa(scoreInput) : null;

  return (
    <>
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

        <div className="vital-form__row">
          <span className="vital-form__label">{JCS_MEASURE.label}</span>
          <select value={values.jcs} aria-label={JCS_MEASURE.label} onChange={(e) => update("jcs", e.target.value)}>
            <option value=""></option>
            {JCS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="vital-form__unit" />
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

        {news2 && (
          <div
            className={`vital-form__row vital-form__row--derived${
              hasEarlyWarningInput(news2) ? ` vital-form__row--ews-${news2.band}` : ""
            }`}
          >
            <span className="vital-form__label">NEWS2</span>
            <span className="vital-form__derived-value">{hasEarlyWarningInput(news2) ? news2.total : "—"}</span>
            <span className="vital-form__unit vital-form__unit--with-help">
              <span title={news2.missing.length && hasEarlyWarningInput(news2) ? news2MissingText(news2.missing) : undefined}>
                点
                {hasEarlyWarningInput(news2) &&
                  `(${EARLY_WARNING_BAND_LABEL[news2.band]})${news2.missing.length ? "・暫定" : ""}`}
              </span>
              <button
                type="button"
                className="modal__help vital-form__help"
                onClick={() => setFormulaOpen(true)}
                aria-label="早期警告スコアの計算式"
                title="早期警告スコアの計算式"
              >
                ?
              </button>
            </span>
          </div>
        )}
        {qsofa && qsofa.missing.length < 3 && (
          <div className="vital-form__row vital-form__row--derived">
            <span className="vital-form__label">qSOFA</span>
            <span className="vital-form__derived-value">{qsofa.score}</span>
            <span className="vital-form__unit">点{qsofa.missing.length ? "・暫定" : ""}</span>
          </div>
        )}
      </div>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>
    {formulaOpen && <EarlyWarningFormulaModal onClose={() => setFormulaOpen(false)} />}
    </>
  );
}
