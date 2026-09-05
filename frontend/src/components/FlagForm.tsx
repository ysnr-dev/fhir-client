import { useState, type FormEvent } from "react";
import { usePatientCautions } from "../api/masterQueries";
import {
  emptyFlagForm,
  FLAG_CATEGORY_OPTIONS,
  FLAG_STATUS_OPTIONS,
  type FlagCategory,
  type FlagFormValues,
  type FlagStatus,
} from "../fhir/flagHelpers";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { CautionPictogram } from "./icons/cautionPictograms";

interface FlagFormProps {
  initialValues?: FlagFormValues;
  onSubmit: (values: FlagFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /** 編集のときだけ状態(有効・終了)を選べる。登録は必ず有効。 */
  editing?: boolean;
}

export function FlagForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  editing = false,
}: FlagFormProps) {
  const [values, setValues] = useState<FlagFormValues>(initialValues ?? emptyFlagForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const cautions = usePatientCautions();

  const update = makeFieldUpdater(setValues);
  const choices = (cautions.data?.items ?? []).filter((c) => c.category === values.category);

  function handleCategoryChange(next: FlagCategory) {
    setValues((prev) => ({
      ...prev,
      category: next,
      // 区分を変えると選べる注意が変わるので、区分違いの選択は捨てる。
      cautionCode: "",
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!values.cautionCode) {
      setValidationError("注意を選択してください。");
      return;
    }
    if (values.periodStart && values.periodEnd && values.periodEnd < values.periodStart) {
      setValidationError("終了日は開始日以降にしてください。");
      return;
    }

    setValidationError(null);
    onSubmit(values);
  }

  const selected = choices.find((c) => c.code === values.cautionCode);

  return (
    <form className="prescription-form" onSubmit={handleSubmit}>
      <div className="condition-form__row">
        <label>
          区分
          <select
            value={values.category}
            onChange={(e) => handleCategoryChange(e.target.value as FlagCategory)}
          >
            {FLAG_CATEGORY_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          注意
          <span className="flag-form__caution">
            <select
              value={values.cautionCode}
              onChange={(e) => update("cautionCode", e.target.value)}
              required
            >
              <option value="">選択してください</option>
              {choices.map((caution) => (
                <option key={caution.id} value={caution.code}>
                  {caution.name}
                </option>
              ))}
            </select>
            {selected?.pictogram && (
              <span className={`flag-form__pictogram flag-form__pictogram--${values.category}`}>
                <CautionPictogram pictogram={selected.pictogram} size={20} />
              </span>
            )}
          </span>
        </label>
      </div>

      <label>
        内容
        <textarea
          value={values.text}
          onChange={(e) => update("text", e.target.value)}
          rows={3}
        />
      </label>

      <div className="condition-form__row">
        <label>
          開始日
          <input
            type="date"
            value={values.periodStart}
            onChange={(e) => update("periodStart", e.target.value)}
          />
        </label>
        <label>
          終了日
          <input
            type="date"
            value={values.periodEnd}
            onChange={(e) => update("periodEnd", e.target.value)}
          />
        </label>
        {editing && (
          <label>
            状態
            <select
              value={values.status}
              onChange={(e) => update("status", e.target.value as FlagStatus)}
            >
              {FLAG_STATUS_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <ErrorBanner error={submitError ?? cautions.error} />

      <div className="prescription-form__actions">
        <button type="submit" disabled={submitting}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
